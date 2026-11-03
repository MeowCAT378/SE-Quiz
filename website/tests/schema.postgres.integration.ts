// Schema mutations are confined to unique schemas in the disposable database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SQL } from 'bun';
import { defaultLlmSettings } from '../src/lib/ai/llmConfiguration';
import type { Account } from '../src/lib/server/accounts';
import { PostgresLlmStore } from '../src/lib/server/llmStorePostgres';
import { initializePostgres } from '../src/lib/server/postgresSchema';
import { exerciseSchemaIntegrity } from './schemaIntegrityChecks';

const target = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
assert(
	target.hostname === '127.0.0.1' && target.port === '55439' && target.pathname === '/auth_test',
	'Use the dedicated disposable database at 127.0.0.1:55439/auth_test'
);
const legacySchema = readFileSync(
	new URL('./fixtures/schema.pre-integrity.postgres.sql', import.meta.url),
	'utf8'
);
const tables = [
	'admins',
	'fuizzes',
	'active_games',
	'auth_login_limits',
	'kv_entries',
	'host_resources',
	'host_games',
	'host_media',
	'host_imports',
	'llm_configurations',
	'llm_state',
	'llm_audit'
];

async function isolated(work: (sql: SQL) => Promise<void>) {
	const schema = `newschemas_${crypto.randomUUID().replaceAll('-', '')}`;
	const admin = new Bun.SQL(target.toString());
	await admin.unsafe(`CREATE SCHEMA ${schema}`);
	const url = new URL(target);
	url.searchParams.set('options', `-c search_path=${schema}`);
	// ALTER changes result types during this rehearsal; deployed processes reconnect at startup.
	const sql = new Bun.SQL(url.toString(), { prepare: false });
	try {
		await work(sql);
	} finally {
		await sql.close();
		await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
		await admin.close();
	}
}

async function snapshot(sql: SQL) {
	return Promise.all(
		tables.map(async (table) => {
			const rows = await sql.unsafe(`SELECT * FROM ${table}`);
			return rows
				.map((row: Record<string, unknown>) =>
					JSON.stringify(
						Object.fromEntries(
							Object.entries(row).map(([key, value]) => [
								key,
								key.endsWith('_at') && table !== 'auth_login_limits' && value !== null
									? new Date(value as string).toISOString()
									: value
							])
						)
					)
				)
				.sort();
		})
	);
}

async function seedLegacy(sql: SQL) {
	await sql.unsafe(legacySchema);
	const actor = { id: crypto.randomUUID(), sessionVersion: 0, role: 'ADMIN' } as Account;
	const resource = crypto.randomUUID(),
		configuration = crypto.randomUUID(),
		game = crypto.randomUUID();
	const instant = '2026-10-05T01:02:03.456Z';
	await sql`INSERT INTO admins(id,email,password_hash,role) VALUES (${actor.id},${`${actor.id}@schema.fixture`},'original-fixture-hash','ADMIN')`;
	await sql`CREATE UNIQUE INDEX admins_stable_id ON admins(id)`;
	await sql`INSERT INTO fuizzes(id,storage_id,title,author,language,slides_count,subjects) VALUES ('legacy-public','legacy-blob','เดิม','Fixture','th',1,' [ "Math" ] ')`;
	await sql`INSERT INTO active_games(quiz_id,game_code) VALUES ('legacy-public','legacy-code')`;
	await sql`INSERT INTO auth_login_limits(key,attempts,expires_at) VALUES ('fixture',1,1800000000000)`;
	await sql`INSERT INTO kv_entries(namespace,key,value,expires_at) VALUES ('fixture','key','untouched bytes','2030-01-01T00:00:00Z')`;
	const body = ` { "versionId": 7, "uniqueId": "${resource}", "lastEdited": 123, "config": { "title": "เดิม", "slides": [] } } `;
	await sql`INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (${actor.id},'creation',${resource},7,${body})`;
	await sql`INSERT INTO host_games(instance_id,code,owner_id,host_watcher_id,origin_unique_id,origin_version_id,session_version) VALUES (${game},'45671',${actor.id},${crypto.randomUUID()},${resource},7,0)`;
	await sql`INSERT INTO host_media(owner_id,hash,content_digest,blob_key,mime,byte_size) VALUES (${actor.id},'legacy-hash','legacy-digest','legacy-blob','image/png',719)`;
	await sql`INSERT INTO host_imports(owner_id,kind,source_kind,source_id,content_digest,copy,unique_id,actor_id) VALUES (${actor.id},'creation','IndexedDB',${resource},'legacy-digest',0,${resource},${actor.id})`;
	const settings = JSON.stringify({
		...defaultLlmSettings(),
		name: 'Existing',
		model: 'served-model',
		endpoint: 'http://localhost:11434/v1',
		enabled: true
	});
	await sql`INSERT INTO llm_configurations(id,settings,encrypted_key,version,created_at,updated_at,created_by,updated_by) VALUES (${configuration},${settings},'original-fixture-ciphertext',3,${instant},${instant},${actor.id},${actor.id})`;
	await sql`INSERT INTO llm_state(id,active_id,version,established,mutation_id) VALUES (1,${configuration},5,1,${crypto.randomUUID()})`;
	await sql`INSERT INTO llm_audit(id,configuration_id,configuration_version,actor_id,created_at,action,changed_fields,credential_action) VALUES (${crypto.randomUUID()},${configuration},3,${actor.id},${instant},'activate',' [ "activeId" ] ','keep')`;
	// Retain soft-deleted history and an explicit timezone offset too.
	await sql`INSERT INTO llm_configurations(id,settings,version,created_at,updated_at,deleted_at,created_by,updated_by) VALUES (${crypto.randomUUID()},${settings},2,'2026-10-05T07:00:00.789+07:00','2026-10-05T08:00:00.789+07:00','2026-10-05T08:00:00.789+07:00',${actor.id},${actor.id})`;
	return { actor, resource, configuration, instant, body };
}

await isolated(async (sql) => {
	// Concurrent fresh startup must not race table or constraint creation.
	await Promise.all([initializePostgres(sql), initializePostgres(sql)]);
	await initializePostgres(sql);
	await exerciseSchemaIntegrity(async (query, params = []) => {
		let index = 0;
		return Array.from(
			await sql.unsafe(
				query.replaceAll('?', () => `$${++index}`),
				params
			)
		);
	});
});

await isolated(async (sql) => {
	const fixture = await seedLegacy(sql);
	const store = new PostgresLlmStore(sql);
	const before = await snapshot(sql);
	const beforeList = await store.list(fixture.actor);
	const beforeAudit = await store.audit(fixture.actor, fixture.configuration);
	const beforeActive = await store.active();
	assert(beforeActive);
	await initializePostgres(sql);
	await initializePostgres(sql);
	assert.deepEqual(await snapshot(sql), before);
	assert.deepEqual(await store.list(fixture.actor), beforeList);
	assert.deepEqual(await store.audit(fixture.actor, fixture.configuration), beforeAudit);
	assert.deepEqual(await store.active(), beforeActive);
	assert.equal(
		(await sql`SELECT body FROM host_resources WHERE unique_id=${fixture.resource}`)[0].body,
		fixture.body
	);
	assert.equal((await sql`SELECT to_regclass('admins_stable_id') AS redundant`)[0].redundant, null);
	assert.equal(
		(
			await sql`SELECT count(*)::int AS count FROM pg_constraint WHERE confrelid='admins'::regclass AND contype='f'`
		)[0].count,
		8
	);
	const columns = await sql`SELECT atttypid::regtype::text AS type FROM pg_attribute WHERE
		(attrelid='llm_configurations'::regclass AND attname IN ('created_at','updated_at','deleted_at'))
		OR (attrelid='llm_audit'::regclass AND attname='created_at')`;
	assert.equal(columns.length, 4);
	assert(columns.every((column: { type: string }) => column.type === 'timestamp with time zone'));
	const updated = await store.save(
		fixture.actor,
		fixture.configuration,
		3,
		{ ...beforeActive.settings, name: 'Edited after upgrade' },
		beforeActive.encryptedKey,
		'keep'
	);
	assert.equal(updated.version, 4);
	assert.equal(updated.createdAt, fixture.instant);
	assert.match(updated.updatedAt, /\.\d{3}Z$/);
	assert.equal(
		(await store.audit(fixture.actor, fixture.configuration)).length,
		beforeAudit.length + 1
	);
	await assert.rejects(
		store.save(fixture.actor, fixture.configuration, 3, beforeActive.settings, null, 'remove'),
		/configuration_conflict/
	);
});

for (const invalid of ['json', 'timestamp'] as const) {
	await isolated(async (sql) => {
		const fixture = await seedLegacy(sql);
		if (invalid === 'json')
			await sql`UPDATE host_resources SET body='[]' WHERE unique_id=${fixture.resource}`;
		else
			await sql`UPDATE llm_configurations SET updated_at='invalid-fixture-time' WHERE id=${fixture.configuration}`;
		const before =
			await sql`SELECT settings,encrypted_key,created_at,updated_at FROM llm_configurations ORDER BY id`;
		await assert.rejects(initializePostgres(sql));
		assert.deepEqual(
			await sql`SELECT settings,encrypted_key,created_at,updated_at FROM llm_configurations ORDER BY id`,
			before
		);
		assert.equal(
			(
				await sql`SELECT atttypid::regtype::text AS type FROM pg_attribute WHERE attrelid='llm_configurations'::regclass AND attname='created_at'`
			)[0].type,
			'text'
		);
		assert.notEqual(
			(await sql`SELECT to_regclass('admins_stable_id') AS original`)[0].original,
			null
		);
		assert.equal(
			(
				await sql`SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='host_resources'::regclass AND conname='host_resources_body_object'`
			)[0].count,
			0
		);
	});
}

await isolated(async (sql) => {
	// A legacy FK may reference admins_stable_id. Its dependency must survive deduplication.
	await sql`CREATE TABLE admins(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,id TEXT NOT NULL)`;
	await sql`CREATE UNIQUE INDEX admins_stable_id ON admins(id)`;
	await sql`CREATE TABLE preserved_reference(owner_id TEXT REFERENCES admins(id))`;
	await sql`CREATE UNIQUE INDEX other_identity_index ON admins(id)`;
	await initializePostgres(sql);
	await initializePostgres(sql);
	assert.equal(
		(
			await sql`SELECT conindid::regclass::text AS index FROM pg_constraint WHERE conrelid='preserved_reference'::regclass AND contype='f'`
		)[0].index,
		'admins_stable_id'
	);
});

console.log(
	'PASS schema fresh/concurrent setup, PostgreSQL integrity, legacy data and API preservation, repeated upgrade, dependency-safe index cleanup, and atomic rollback'
);
