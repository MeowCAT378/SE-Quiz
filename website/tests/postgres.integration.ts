// Run with Bun and TEST_DATABASE_URL pointing to a disposable PostgreSQL database.
// The transaction rolls back all test records; schema setup is idempotent.
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../src/lib/db/postgres';
import { PostgresKVStore } from '../src/lib/kv/postgres';
import { getPostgres } from '../src/lib/server/postgres';
import { initializePostgres } from '../src/lib/server/postgresSchema';

const url = process.env.TEST_DATABASE_URL;
assert(url, 'TEST_DATABASE_URL is required');
const target = new URL(url);
assert(
	target.hostname === '127.0.0.1' && target.port === '55439' && target.pathname === '/auth_test',
	'Use the dedicated disposable database at 127.0.0.1:55439/auth_test'
);
const sql = await getPostgres(url);
assert.equal(await getPostgres(url), sql);
try {
	await initializePostgres(sql);
	await initializePostgres(sql);
	const rollback = new Error('rollback test records');
	await sql
		.begin(async (tx) => {
			const db = new PostgresDatabase(tx);
			assert(await db.tableExists());
			const id = crypto.randomUUID();
			const data = {
				id,
				storage_id: id,
				title: 'Thai math',
				author: 'Tester',
				language: 'th',
				subjects: '["Mathematics"]',
				grades: '["University"]',
				keywords: '["fractions"]',
				slides_count: 2,
				thumbnail: new Uint8Array([0, 128, 255]),
				thumbnail_alt: 'test',
				git_commit_sha: null,
				played_count: 3,
				view_count: 4,
				published_at: '2026-09-09T00:00:00.000Z',
				updated_at: '2026-09-09T00:00:00.000Z'
			};
			await db.insertFuiz(data);
			assert.equal((await db.getById(id))?.published_at, data.published_at);
			const saved = await db.getById(id);
			assert(saved?.thumbnail);
			assert.deepEqual(new Uint8Array(saved.thumbnail), data.thumbnail);
			assert((await db.getRecentlyPublished(100)).some((quiz) => quiz.storage_id === id));
			assert((await db.getDistinctLanguages()).includes('th'));
			assert.equal(
				(await db.search('MATH', { languages: ['th'], grades: ['University'] }, 100)).length,
				1
			);
			assert.equal((await db.search('', { languages: ["th' OR 1=1 --"] }, 100)).length, 0);
			assert((await db.search('', {}, 100)).length >= 1);
			await db.insertFuiz({ ...data, title: 'Updated', played_count: 9 });
			assert.equal((await db.getById(id))?.title, 'Updated');
			assert.equal((await db.getExistingStats(id))?.played_count, 9);
			assert.equal((await db.getExistingStats(id))?.published_at, data.published_at);
			await db.setActiveGame(id, '123456');
			assert.equal(typeof (await db.getActiveGame(id))?.started_at, 'string');
			await db.setActiveGame(id, '654321');
			assert.equal((await db.getActiveGame(id))?.game_code, '654321');
			assert((await db.getActiveGames()).some((game) => game.quiz_id === id));
			await db.removeActiveGameByCode('654321');
			assert.equal(await db.getActiveGame(id), null);
			await db.setActiveGame(id, '123456');
			await db.removeActiveGame(id);
			assert.equal(await db.getActiveGame(id), null);
			const share = new PostgresKVStore(tx, 'test-share');
			const jobs = new PostgresKVStore(tx, 'test-jobs');
			await share.put(id, '{"ok":true}');
			assert.deepEqual(await share.get(id, 'json'), { ok: true });
			assert.equal(await jobs.get(id), null);
			await jobs.put(id, 'job');
			await share.put(id, 'expired', { expirationTtl: 0 });
			assert.equal(await share.get(id), null);
			assert.equal(await jobs.get(id), 'job');
			await share.put(id, 'fresh', { expirationTtl: 60 });
			assert.equal(await share.get(id), 'fresh');
			await share.delete(id);
			assert.equal(await share.get(id), null);
			await db.deleteFuiz(id);
			assert.equal(await db.getById(id), null);
			assert.equal(await db.getExistingStats(id), null);
			throw rollback;
		})
		.catch((error) => {
			if (error !== rollback) throw error;
		});
	console.log('PostgreSQL integration passed (schema, CRUD/search/upsert, KV isolation/TTL).');
} finally {
	await sql.close();
}

await import('./accounts.postgres.integration');
await import('./seedUsers.postgres.integration');
await import('./hostGames.postgres.integration');
await import('./privateResources.postgres.integration');
await import('./demoGames.postgres.integration');
await import('./schema.postgres.integration');
