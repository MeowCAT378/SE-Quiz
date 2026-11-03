import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PostgresAccountStore } from '../src/lib/server/accountsPostgres';
import { upgradePostgresAccounts } from '../src/lib/server/accountUpgrade';
import { hashPassword } from '../src/lib/server/password';

assert(process.env.TEST_DATABASE_URL, 'A disposable TEST_DATABASE_URL is required');
const schema = `accounts_test_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new Bun.SQL(process.env.TEST_DATABASE_URL);
await admin.unsafe(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('options', `-c search_path=${schema}`);
const sql = new Bun.SQL(url.toString());
try {
	const hash = await hashPassword('old');
	await sql`CREATE TABLE admins(email TEXT PRIMARY KEY CHECK(email=lower(trim(email))),password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
	await sql`INSERT INTO admins(email,password_hash,created_at) VALUES ('legacy@example.test',${hash},'2020-01-01T00:00:00Z')`;
	await sql`CREATE TABLE preserved_data (id TEXT PRIMARY KEY, payload TEXT)`;
	await sql`INSERT INTO preserved_data VALUES ('legacy-resource','untouched bytes')`;
	await upgradePostgresAccounts(sql);
	const [first] = await sql`SELECT * FROM admins`;
	await upgradePostgresAccounts(sql);
	assert.deepEqual((await sql`SELECT * FROM admins`)[0], first);
	assert.equal(first.password_hash, hash);
	assert.equal(first.role, 'ADMIN');
	assert.equal((await sql`SELECT payload FROM preserved_data`)[0].payload, 'untouched bytes');
	await sql.unsafe(readFileSync(new URL('../src/schema.postgres.sql', import.meta.url), 'utf8'));
	const store = new PostgresAccountStore(sql);
	assert.equal(await store.seed(), false);
	assert.equal(await store.seed('another@example.test', 'replacement-password'), false);
	assert.equal((await store.authenticate(' LEGACY@EXAMPLE.TEST ', 'old'))?.id, first.id);
	const teacher = await store.create(first.id, 0, {
		email: 'TEACHER@example.test',
		password: 'teacher password'
	});
	assert.equal(teacher.role, 'TEACHER');
	assert(!('sessionVersion' in teacher));
	assert(!('password_hash' in teacher));
	await assert.rejects(
		store.create(first.id, 0, { email: 'teacher@example.test', password: 'another password' }),
		/reserved/
	);
	await assert.rejects(store.softDelete(first.id, 0, first.id), /last active administrator/);
	await assert.rejects(
		store.update(first.id, 0, first.id, { role: 'TEACHER' }),
		/last active administrator/
	);
	await store.softDelete(first.id, 0, teacher.id);
	assert.equal(await store.findActiveById(teacher.id), null);
	assert.equal(await store.authenticate(teacher.email, 'teacher password'), null);
	await assert.rejects(
		store.create(first.id, 0, { email: teacher.email, password: 'another password' }),
		/reserved/
	);
	const second = await store.create(first.id, 0, {
		email: 'second@example.test',
		password: 'second password',
		role: 'ADMIN'
	});
	const results = await Promise.allSettled([
		store.update(first.id, 0, first.id, { role: 'TEACHER' }),
		store.update(second.id, 0, second.id, { role: 'TEACHER' })
	]);
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
	const [survivor] = (await store.list()).filter((a) => a.role === 'ADMIN' && !a.deletedAt);
	const demoted = survivor.id === first.id ? second : first;
	await assert.rejects(
		store.create(demoted.id, 0, {
			email: 'unauthorized@example.test',
			password: 'unauthorized password'
		}),
		/Administrator access/
	);
	await store.update(survivor.id, 0, demoted.id, {
		email: 'changed@example.test',
		password: 'changed password'
	});
	assert.equal((await store.findActiveById(demoted.id))?.sessionVersion, 2);
	assert.equal(await store.revokeSessions(survivor.id, 0), true);
	assert.equal(await store.revokeSessions(survivor.id, 0), false);
	const failed = await Promise.all(
		Array.from({ length: 12 }, () => store.login('missing@example.test', 'wrong', 'test-address'))
	);
	assert.equal(failed.filter((r) => r.retryAfter === 0).length, 10);
	assert.equal(failed.filter((r) => r.retryAfter > 0).length, 2);
	class LoginLimitProbe extends PostgresAccountStore {
		reserve(keys: string[], now: number) {
			return this.reserveLogin(keys, now);
		}
	}
	const limits = new LoginLimitProbe(sql);
	const now = Date.now();
	for (let i = 0; i < 100; i++)
		assert.equal((await limits.reserve(['address-cap', `pair-cap-${i}`], now)).allowed, true);
	const [{ count: beforeBlocked }] =
		await sql`SELECT count(*)::int AS count FROM auth_login_limits`;
	for (let i = 100; i < 150; i++)
		assert.equal((await limits.reserve(['address-cap', `pair-cap-${i}`], now)).allowed, false);
	assert.equal(
		(await sql`SELECT count(*)::int AS count FROM auth_login_limits`)[0].count,
		beforeBlocked
	);
	await sql`INSERT INTO auth_login_limits(key,attempts,expires_at) SELECT 'expired-' || n, 5, ${now - 1} FROM generate_series(1,150) AS n`;
	await limits.reserve(['address-cleanup', 'pair-cleanup'], now);
	assert.equal(
		(await sql`SELECT count(*)::int AS count FROM auth_login_limits WHERE expires_at <= ${now}`)[0]
			.count,
		50
	);
	await limits.reserve(['address-cleanup', 'pair-cleanup'], now);
	assert.equal(
		(await sql`SELECT count(*)::int AS count FROM auth_login_limits WHERE expires_at <= ${now}`)[0]
			.count,
		0
	);
	assert.equal((await limits.reserve(['address-cap', 'still-blocked'], now)).allowed, false);
	assert.equal(
		(await limits.reserve(['address-cap', 'pair-new-window'], now + 900001)).allowed,
		true
	);
	console.log(
		'PostgreSQL account upgrade twice, exact hash/data preservation, legacy password, default teacher, uniqueness, deletion, versions, concurrent last-admin and login limits passed.'
	);
} finally {
	await sql.close();
	await admin.close();
}

// Independent empty schemas exercise bootstrap races and collision refusal without touching existing rows.
for (const collision of [false, true]) {
	const setup = new Bun.SQL(process.env.TEST_DATABASE_URL);
	const name = `accounts_seed_${crypto.randomUUID().replaceAll('-', '')}`;
	await setup.unsafe(`CREATE SCHEMA ${name}`);
	url.searchParams.set('options', `-c search_path=${name}`);
	const seedSql = new Bun.SQL(url.toString());
	try {
		await seedSql.unsafe(
			readFileSync(new URL('../src/schema.postgres.sql', import.meta.url), 'utf8')
		);
		const store = new PostgresAccountStore(seedSql);
		if (collision) {
			await seedSql`INSERT INTO admins(id,email,password_hash,role,deleted_at) VALUES (${crypto.randomUUID()},'seed@example.test','preserved','TEACHER',NOW())`;
			await assert.rejects(store.seed('seed@example.test', 'seed password'), /existing account/);
			assert.equal((await seedSql`SELECT password_hash FROM admins`)[0].password_hash, 'preserved');
		} else {
			const results = await Promise.all([
				store.seed('one@example.test', 'seed password'),
				store.seed('two@example.test', 'seed password')
			]);
			assert.equal(results.filter(Boolean).length, 1);
			assert.equal(await store.seed(), false);
		}
	} finally {
		await seedSql.close();
		await setup.close();
	}
}
console.log(
	'PostgreSQL concurrent distinct-email bootstrap and reserved deleted-email collision passed.'
);
