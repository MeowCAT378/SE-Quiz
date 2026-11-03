import type { D1Database } from '@cloudflare/workers-types';
import type { SQL } from 'bun';
import { expect, it, vi } from 'vitest';
import { D1DatabaseAdapter } from '../src/lib/db/d1';
import { PostgresDatabase } from '../src/lib/db/postgres';

it.each([
	{ rows: [] },
	{ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] }
])('providers return only IDs: %j', async ({ rows }) => {
	const sql = vi.fn().mockResolvedValue(rows);
	const all = vi.fn().mockResolvedValue({ results: rows });
	const prepare = vi.fn().mockReturnValue({ all });
	const postgres = new PostgresDatabase(sql as unknown as SQL);
	const d1 = new D1DatabaseAdapter({ prepare } as unknown as D1Database);
	expect(await postgres.getPublishedIds()).toEqual(rows.map((row) => row.id));
	expect(await d1.getPublishedIds()).toEqual(rows.map((row) => row.id));
	expect(sql.mock.calls[0][0].join('')).toBe('SELECT id FROM fuizzes');
	expect(prepare).toHaveBeenCalledWith('SELECT id FROM fuizzes');
});
it('both providers propagate failures', async () => {
	const failure = new Error('provider unavailable');
	const postgres = new PostgresDatabase(vi.fn().mockRejectedValue(failure) as unknown as SQL);
	const d1 = new D1DatabaseAdapter({
		prepare: () => ({ all: () => Promise.reject(failure) })
	} as unknown as D1Database);
	await expect(postgres.getPublishedIds()).rejects.toBe(failure);
	await expect(d1.getPublishedIds()).rejects.toBe(failure);
});

it('D1 SQL publishes, updates and removes against SQLite without touching private records', async () => {
	const { DatabaseSync } = await import('node:sqlite');
	const { readFileSync } = await import('node:fs');
	const sqlite = new DatabaseSync(':memory:');
	try {
		sqlite.exec(readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8'));
		sqlite.exec(
			"CREATE TABLE private_sentinel (body TEXT); INSERT INTO private_sentinel VALUES ('unchanged')"
		);
		const d1 = new D1DatabaseAdapter({
			prepare: (sql: string) => {
				const statement = sqlite.prepare(sql);
				const bound = (values: any[] = []) => ({
					bind: (...params: any[]) => bound(params),
					all: async () => ({ results: statement.all(...values) }),
					run: async () => statement.run(...values)
				});
				return bound();
			}
		} as unknown as D1Database);
		const record = {
			id: '11111111-1111-4111-8111-111111111111',
			storage_id: '11111111-1111-4111-8111-111111111111',
			title: 'Original',
			author: 'Admin',
			language: 'en',
			subjects: null,
			grades: null,
			keywords: null,
			slides_count: 1,
			thumbnail: null,
			thumbnail_alt: null,
			git_commit_sha: null,
			played_count: 0,
			view_count: 0,
			published_at: '2026-09-20T00:00:00Z',
			updated_at: '2026-09-20T00:00:00Z'
		};
		await d1.insertFuiz(record);
		await d1.insertFuiz({ ...record, title: 'Updated' });
		expect(await d1.getPublishedIds()).toEqual([record.id]);
		expect(sqlite.prepare('SELECT title FROM fuizzes').get()?.title).toBe('Updated');
		await d1.deleteFuiz(record.id);
		expect(await d1.getPublishedIds()).toEqual([]);
		expect(sqlite.prepare('SELECT body FROM private_sentinel').get()?.body).toBe('unchanged');
	} finally {
		sqlite.close();
	}
});
