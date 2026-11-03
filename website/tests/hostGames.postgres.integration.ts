import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PostgresHostGameStore } from '../src/lib/server/hostGamesPostgres';
import { exerciseHostStore } from './hostStoreChecks';

assert(process.env.TEST_DATABASE_URL, 'Disposable TEST_DATABASE_URL required');
const connection = new URL(process.env.TEST_DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
assert.equal(connection.port, '55439');
assert.equal(connection.pathname, '/auth_test');
const schema = `host_test_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new Bun.SQL(connection.toString());
await admin.unsafe(`CREATE SCHEMA ${schema}`);
connection.searchParams.set('options', `-c search_path=${schema}`);
const sql = new Bun.SQL(connection.toString());
try {
	const source = readFileSync(new URL('../src/schema.postgres.sql', import.meta.url), 'utf8');
	await sql.unsafe(source);
	await sql`INSERT INTO active_games VALUES ('legacy','123456','2020-01-01')`;
	await sql.unsafe(source);
	assert.equal((await sql`SELECT game_code FROM active_games`)[0].game_code, '123456');
	await exerciseHostStore(new PostgresHostGameStore(sql), async (query, params = []) => {
		let position = 0;
		return await sql.unsafe(
			query.replaceAll('?', () => `$${++position}`),
			params
		);
	});
	console.log(
		'PostgreSQL host ownership, origin version, revocation, code reuse and retained historical data checks passed.'
	);
} finally {
	await sql.close();
	await admin.close();
}
