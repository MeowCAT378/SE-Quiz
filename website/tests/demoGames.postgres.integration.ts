import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemBlobStorage } from '../src/lib/blob/filesystem';
import { accountFromRow } from '../src/lib/server/accounts';
import { demoGames, demoPinMedia, seedDemoGames } from '../src/lib/server/demoGames';
import { PostgresPrivateResourceStore } from '../src/lib/server/privateResourcesPostgres';

assert(process.env.TEST_DATABASE_URL, 'Disposable TEST_DATABASE_URL required');
const connection = new URL(process.env.TEST_DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
assert.equal(connection.port, '55439');
assert.equal(connection.pathname, '/auth_test');
const schema = `demo_test_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new Bun.SQL(connection.toString());
await admin.unsafe(`CREATE SCHEMA ${schema}`);
connection.searchParams.set('options', `-c search_path=${schema}`);
const sql = new Bun.SQL(connection.toString());
const directory = await mkdtemp(join(tmpdir(), 'seopen-demo-'));
try {
	await sql.file(fileURLToPath(new URL('../src/schema.postgres.sql', import.meta.url)));
	const blob = new FilesystemBlobStorage(directory);
	await assert.rejects(seedDemoGames(sql, blob), /active teacher or administrator/);
	const [teacher] =
		await sql`INSERT INTO admins(id,email,password_hash,role) VALUES (${crypto.randomUUID()},'demo-teacher@example.invalid','unused','TEACHER') RETURNING *`;
	const [owner] =
		await sql`INSERT INTO admins(id,email,password_hash,role) VALUES (${crypto.randomUUID()},'demo-admin@example.invalid','unused','ADMIN') RETURNING *`;
	const resources = new PostgresPrivateResourceStore(sql, blob);
	const actor = accountFromRow(owner);
	const legacy = { ...demoGames[0], uniqueId: '10000000-0000-4000-8000-000000000001' };
	await resources.write(actor, 'creation', legacy, null);
	const before = await sql`SELECT * FROM host_resources`;

	assert.deepEqual(await seedDemoGames(sql, blob), { created: 15, total: 15 });
	const records = await resources.list(actor, 'creation');
	assert.equal(records.length, 16);
	assert.deepEqual(await resources.list(accountFromRow(teacher), 'creation'), []);
	assert.deepEqual(await resources.getMedia(actor, demoPinMedia.hash), {
		Image: { Base64: { ...demoPinMedia.value.Image.Base64, hash: demoPinMedia.hash } }
	});
	assert.equal(await resources.getMedia(accountFromRow(teacher), demoPinMedia.hash), null);
	assert.deepEqual(
		await sql`SELECT * FROM host_resources WHERE unique_id=${legacy.uniqueId}`,
		before
	);

	const edited = structuredClone(demoGames[0]);
	edited.config.title = 'Teacher-edited demo';
	edited.versionId = 1;
	await resources.write(actor, 'creation', edited, 0);
	const snapshot = await sql`SELECT * FROM host_resources ORDER BY unique_id`;
	const media = await sql`SELECT * FROM host_media`;
	assert.deepEqual(await seedDemoGames(sql, blob), { created: 0, total: 15 });
	assert.deepEqual(await sql`SELECT * FROM host_resources ORDER BY unique_id`, snapshot);
	assert.deepEqual(await sql`SELECT * FROM host_media`, media);
	assert.equal(media.length, 1);
	console.log(
		'Demo seed passed: 15 games, owned pin media, repeat seed, preserved edits and legacy data.'
	);
} finally {
	await sql.close();
	await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
	await admin.close();
	await rm(directory, { recursive: true, force: true });
}
