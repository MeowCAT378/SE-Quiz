import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { D1HostGameStore } from '../src/lib/server/hostGamesD1';
import { exerciseHostStore } from './hostStoreChecks';

it('adds owner and instance tables without rewriting legacy active mappings', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch(){ return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const schema = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8')
			.replace(/--[^\n]*/g, '')
			.split(/;\s*(?=CREATE|$)/i)
			.map((s) => s.trim())
			.filter(Boolean);
		await db.batch(schema.map((s) => db.prepare(s)));
		await db.prepare("INSERT INTO active_games VALUES ('legacy','123456','2020-01-01')").run();
		await db.batch(schema.map((s) => db.prepare(s)));
		expect(
			(
				await db
					.prepare("SELECT name FROM sqlite_master WHERE type='table'")
					.all<{ name: string }>()
			).results.map((r) => r.name)
		).toEqual(expect.arrayContaining(['host_games', 'host_resources']));
		expect(await db.prepare('SELECT * FROM active_games').first()).toEqual({
			quiz_id: 'legacy',
			game_code: '123456',
			started_at: '2020-01-01'
		});
		await exerciseHostStore(
			new D1HostGameStore(db),
			async (statement, params = []) =>
				(
					await db
						.prepare(statement)
						.bind(...params)
						.all()
				).results
		);
	} finally {
		await runtime.dispose();
	}
}, 60000);
