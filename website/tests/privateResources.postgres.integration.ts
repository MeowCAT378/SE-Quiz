import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemBlobStorage } from '../src/lib/blob/filesystem';
import { PostgresPrivateResourceStore } from '../src/lib/server/privateResourcesPostgres';
import { exercisePrivateFailures } from './privateFailureChecks';
import { exercisePrivateStore } from './privateStoreChecks';
import { exercisePrivateUpgrade } from './privateUpgradeChecks';

assert(process.env.TEST_DATABASE_URL, 'Disposable TEST_DATABASE_URL required');
const connection = new URL(process.env.TEST_DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
assert.equal(connection.port, '55439');
assert.equal(connection.pathname, '/auth_test');
const schema = `private_test_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new Bun.SQL(connection.toString());
await admin.unsafe(`CREATE SCHEMA ${schema}`);
connection.searchParams.set('options', `-c search_path=${schema}`);
const sql = new Bun.SQL(connection.toString());
const dir = await mkdtemp(join(tmpdir(), 'seopen-private-'));
try {
	const source = readFileSync(new URL('../src/schema.postgres.sql', import.meta.url), 'utf8');
	const query = async (query: string, params: (string | number | null)[] = []) => {
		let position = 0;
		return await sql.unsafe(
			query.replaceAll('?', () => `$${++position}`),
			params
		);
	};
	await sql.unsafe(source.split('-- Additive private storage upgrade:')[0]);
	await sql`INSERT INTO kv_entries(namespace,key,value) VALUES ('legacy','original','{"data":"unchanged"}')`;
	const kv = await sql`SELECT * FROM kv_entries`;
	await exercisePrivateUpgrade(query, async () => {
		await sql.unsafe(source);
	});
	assert.deepEqual(await sql`SELECT * FROM kv_entries`, kv);
	await exercisePrivateStore(
		new PostgresPrivateResourceStore(sql, new FilesystemBlobStorage(dir)),
		query
	);
	await exercisePrivateFailures(
		(blob) => new PostgresPrivateResourceStore(sql, blob),
		new FilesystemBlobStorage(dir),
		query
	);
	console.log(
		'PostgreSQL private resources, media, imports, concurrent CAS, current authority and historical binding passed.'
	);
} finally {
	await sql.close();
	await admin.close();
	await rm(dir, { recursive: true, force: true });
}
