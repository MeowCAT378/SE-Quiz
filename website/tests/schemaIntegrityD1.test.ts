import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { exerciseSchemaIntegrity } from './schemaIntegrityChecks';

it('upgrades existing D1 tables and preserves JSON bytes while rejecting invalid writes', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const source = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
		const apply = async (sql: string) => {
			const statements = sql
				.replace(/--[^\n]*/g, '')
				.split(/;\s*(?=CREATE|$)/i)
				.filter((s) => s.trim());
			await db.batch(statements.map((s) => db.prepare(s)));
		};
		await apply(source.split('-- Data integrity:')[0]);
		await db
			.prepare(
				"INSERT INTO fuizzes(id,storage_id,title,author,language,slides_count,subjects) VALUES ('legacy','legacy','Legacy','Legacy','th',1,' [ \"Math\" ] ')"
			)
			.run();
		const before = await db.prepare('SELECT * FROM fuizzes').all();
		await apply(source);
		await apply(source);
		expect((await db.prepare('SELECT * FROM fuizzes').all()).results).toEqual(before.results);
		await exerciseSchemaIntegrity(
			async (sql, params = []) =>
				(
					await db
						.prepare(sql)
						.bind(...params)
						.all()
				).results
		);
	} finally {
		await runtime.dispose();
	}
}, 60000);
