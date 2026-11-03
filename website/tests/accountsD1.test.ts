import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { D1AccountStore } from '../src/lib/server/accountsD1';
import { d1AccountUpgradeStatements } from '../src/lib/server/accountUpgradeD1';
import { hashPassword } from '../src/lib/server/password';

it('enforces managed mutations and concurrent limits in the supported local D1 runtime', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const schema = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
		// D1 exec splits by lines: prepare complete statements including trigger bodies in a batch.
		const statements = schema
			.replace(/--[^\n]*/g, '')
			.split(/;\s*(?=CREATE|$)/i)
			.map((s) => s.trim())
			.filter(Boolean);
		await db.batch(statements.map((statement) => db.prepare(statement)));
		await db.batch(statements.map((statement) => db.prepare(statement)));
		const store = new D1AccountStore(db);
		const seeded = await Promise.all([
			store.seed('one@example.test', 'seed password'),
			store.seed('two@example.test', 'seed password')
		]);
		expect(seeded.filter(Boolean)).toHaveLength(1);
		expect(await store.seed()).toBe(false);
		const [first] = await store.list();
		const teacher = await store.create(first.id, 0, {
			email: 'teacher@example.test',
			password: 'teacher password'
		});
		expect(teacher.role).toBe('TEACHER');
		expect(Object.keys(teacher)).not.toContain('sessionVersion');
		await expect(store.update(first.id, 0, first.id, { role: 'TEACHER' })).rejects.toThrow(
			/last active administrator/
		);
		await expect(store.softDelete(first.id, 0, first.id)).rejects.toThrow(
			/last active administrator/
		);
		await expect(
			db.prepare('DELETE FROM admins WHERE id=?').bind(teacher.id).run()
		).rejects.toThrow(/physical account deletion/);
		const second = await store.create(first.id, 0, {
			email: 'other@example.test',
			password: 'other password',
			role: 'ADMIN'
		});
		const demotions = await Promise.allSettled([
			store.update(first.id, 0, first.id, { role: 'TEACHER' }),
			store.update(second.id, 0, second.id, { role: 'TEACHER' })
		]);
		expect(demotions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const [survivor] = (await store.list()).filter((a) => a.role === 'ADMIN');
		const demoted = survivor.id === first.id ? second : first;
		await expect(
			store.create(demoted.id, 0, { email: 'bad@example.test', password: 'unauthorized password' })
		).rejects.toThrow(/Administrator access/);
		await store.softDelete(survivor.id, 0, teacher.id);
		expect(await store.findActiveById(teacher.id)).toBeNull();
		expect(await store.authenticate(teacher.email, 'teacher password')).toBeNull();
		await expect(
			store.create(survivor.id, 0, { email: teacher.email, password: 'another password' })
		).rejects.toThrow(/conflict/);
		await store.update(survivor.id, 0, demoted.id, {
			password: 'replacement password',
			email: 'changed@example.test'
		});
		expect((await store.findActiveById(demoted.id))?.sessionVersion).toBe(2);
		expect(await store.revokeSessions(survivor.id, 0)).toBe(true);
		expect(await store.revokeSessions(survivor.id, 0)).toBe(false);
		const failures = await Promise.all(
			Array.from({ length: 12 }, () => store.login('unknown@example.test', 'bad', 'local-client'))
		);
		expect(failures.filter((r) => r.retryAfter === 0)).toHaveLength(10);
		expect(failures.filter((r) => r.retryAfter > 0)).toHaveLength(2);
		class LoginLimitProbe extends D1AccountStore {
			reserve(keys: string[], now: number) {
				return this.reserveLogin(keys, now);
			}
		}
		const limits = new LoginLimitProbe(db);
		const now = Date.now();
		for (let i = 0; i < 100; i++)
			expect((await limits.reserve(['address-cap', `pair-cap-${i}`], now)).allowed).toBe(true);
		const beforeBlocked = await db
			.prepare('SELECT count(*) AS count FROM auth_login_limits')
			.first<{ count: number }>();
		for (let i = 100; i < 150; i++)
			expect((await limits.reserve(['address-cap', `pair-cap-${i}`], now)).allowed).toBe(false);
		expect(await db.prepare('SELECT count(*) AS count FROM auth_login_limits').first()).toEqual(
			beforeBlocked
		);
		await db.batch(
			Array.from({ length: 150 }, (_, i) =>
				db
					.prepare('INSERT INTO auth_login_limits(key,attempts,expires_at) VALUES (?,5,?)')
					.bind(`expired-${i}`, now - 1)
			)
		);
		await limits.reserve(['address-cleanup', 'pair-cleanup'], now);
		expect(
			(
				await db
					.prepare('SELECT count(*) AS count FROM auth_login_limits WHERE expires_at <= ?')
					.bind(now)
					.first<{ count: number }>()
			)?.count
		).toBe(50);
		await limits.reserve(['address-cleanup', 'pair-cleanup'], now);
		expect(
			(
				await db
					.prepare('SELECT count(*) AS count FROM auth_login_limits WHERE expires_at <= ?')
					.bind(now)
					.first<{ count: number }>()
			)?.count
		).toBe(0);
		expect((await limits.reserve(['address-cap', 'still-blocked'], now)).allowed).toBe(false);
		expect((await limits.reserve(['address-cap', 'pair-new-window'], now + 900001)).allowed).toBe(
			true
		);
		const legacyHash = await hashPassword('old');
		// Private provisioning preserves short legacy passwords and remains race/collision safe.
		await db
			.prepare('INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,?,?)')
			.bind(crypto.randomUUID(), 'legacy@example.test', legacyHash, 'TEACHER')
			.run();
		expect((await store.authenticate(' LEGACY@EXAMPLE.TEST ', 'old'))?.role).toBe('TEACHER');
		expect(
			(
				await db
					.prepare('SELECT password_hash FROM admins WHERE email=?')
					.bind('legacy@example.test')
					.first<{ password_hash: string }>()
			)?.password_hash
		).toBe(legacyHash);
	} finally {
		await runtime.dispose();
	}
}, 60000);

it('upgrades a populated legacy D1 account twice without changing identity, hashes or other data', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch(){ return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const hash = await hashPassword('old');
		await db.batch([
			db.prepare(
				'CREATE TABLE admins(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,created_at TEXT NOT NULL)'
			),
			db
				.prepare('INSERT INTO admins VALUES (?,?,?)')
				.bind('legacy@example.test', hash, '2020-01-01T00:00:00Z'),
			db.prepare('CREATE TABLE preserved_data(id TEXT PRIMARY KEY,payload TEXT)'),
			db.prepare("INSERT INTO preserved_data VALUES ('old','untouched bytes')")
		]);
		let snapshot: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			const columns = (
				await db.prepare('PRAGMA table_info(admins)').all<{ name: string }>()
			).results.map((r) => r.name);
			const rows = (
				await db
					.prepare(
						columns.includes('id') ? 'SELECT email,id FROM admins' : 'SELECT email FROM admins'
					)
					.all<{ email: string; id?: string | null }>()
			).results;
			await db.batch(d1AccountUpgradeStatements(columns, rows).map((s) => db.prepare(s)));
			const current = await db.prepare('SELECT * FROM admins').first();
			if (attempt === 0) snapshot = current;
			else expect(current).toEqual(snapshot);
		}
		const store = new D1AccountStore(db);
		expect((await store.authenticate(' LEGACY@EXAMPLE.TEST ', 'old'))?.role).toBe('ADMIN');
		expect(
			(await db.prepare('SELECT password_hash FROM admins').first<{ password_hash: string }>())
				?.password_hash
		).toBe(hash);
		expect(
			(await db.prepare('SELECT payload FROM preserved_data').first<{ payload: string }>())?.payload
		).toBe('untouched bytes');
	} finally {
		await runtime.dispose();
	}
}, 60000);
