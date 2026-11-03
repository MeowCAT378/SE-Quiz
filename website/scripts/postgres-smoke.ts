import assert from 'node:assert/strict';
import { SQL } from 'bun';
import { PostgresDatabase } from '../src/lib/db/postgres';
import { PostgresKVStore } from '../src/lib/kv/postgres';
import { initializePostgres } from '../src/lib/postgres';

const databaseUrl = process.env.POSTGRES_SMOKE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
assert(databaseUrl, 'An explicit disposable PostgreSQL test URL is required');
const target = new URL(databaseUrl);
assert(
	target.hostname === '127.0.0.1' && target.port === '55439' && target.pathname === '/auth_test',
	'Use the dedicated disposable test database at 127.0.0.1:55439/auth_test'
);
const sql = new SQL(databaseUrl, { max: 2, connectionTimeout: 10 });
const id = `smoke-${crypto.randomUUID()}`;
const namespace = `smoke_${crypto.randomUUID().replaceAll('-', '')}`;
const gameCode = crypto.randomUUID().slice(0, 8);
const now = new Date().toISOString();
const db = new PostgresDatabase(sql);
const kv = new PostgresKVStore(sql, namespace);
const quiz = {
	id,
	storage_id: id,
	title: 'PostgreSQL smoke alpha',
	author: 'Smoke Test',
	language: 'en',
	subjects: JSON.stringify(['Math']),
	grades: JSON.stringify(['University']),
	keywords: JSON.stringify(['postgres']),
	slides_count: 1,
	thumbnail: new Uint8Array([1, 2, 3]),
	thumbnail_alt: 'Smoke thumbnail',
	git_commit_sha: null,
	played_count: 2,
	view_count: 3,
	published_at: now,
	updated_at: now
};

try {
	await initializePostgres(sql);
	assert.equal(await db.tableExists(), true);
	await db.insertFuiz(quiz);
	assert.equal((await db.getById(id))?.title, quiz.title);
	await db.insertFuiz({
		...quiz,
		title: 'PostgreSQL smoke beta',
		view_count: 4
	});
	assert.equal((await db.getExistingStats(id))?.view_count, 4);
	assert.equal((await db.search('beta', { languages: ['en'], subjects: ['Math'] }, 5))[0]?.id, id);
	assert.ok((await db.getRecentlyPublished(50)).some((row) => row.id === id));
	assert.ok((await db.getDistinctLanguages()).includes('en'));

	await db.setActiveGame(id, gameCode);
	assert.equal((await db.getActiveGame(id))?.game_code, gameCode);
	assert.ok((await db.getActiveGames()).some((game) => game.quiz_id === id));
	await db.removeActiveGameByCode(gameCode);
	assert.equal(await db.getActiveGame(id), null);

	await kv.put('text', 'value');
	assert.equal(await kv.get('text'), 'value');
	await kv.put('json', JSON.stringify({ ok: true }));
	assert.deepEqual(await kv.get('json', 'json'), { ok: true });
	await kv.put('expired', 'gone', { expirationTtl: 0 });
	assert.equal(await kv.get('expired'), null);
	// Reads enforce TTL independently of the intentionally probabilistic physical cleanup.
	await kv.put('fresh', 'present', { expirationTtl: 60 });
	assert.equal(await kv.get('fresh'), 'present');
	await kv.delete('text');
	assert.equal(await kv.get('text'), null);

	await assert.rejects(() =>
		db.insertFuiz({
			...quiz,
			id: `${id}-invalid`,
			storage_id: `${id}-invalid`,
			slides_count: -1
		})
	);
	console.log('PostgreSQL smoke test passed');
} finally {
	await sql`DELETE FROM active_games WHERE quiz_id = ${id} OR game_code = ${gameCode}`;
	await sql`DELETE FROM fuizzes WHERE id = ${id} OR id = ${`${id}-invalid`}`;
	await sql`DELETE FROM kv_entries WHERE namespace = ${namespace}`;
	await sql.close();
}
