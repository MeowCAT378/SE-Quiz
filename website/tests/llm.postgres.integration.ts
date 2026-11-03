// Only a disposable TEST_DATABASE_URL. All fixture credentials are public synthetic values.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultLlmSettings } from '../src/lib/ai/llmConfiguration';
import type { Account } from '../src/lib/server/accounts';
import { PostgresLlmStore } from '../src/lib/server/llmStorePostgres';
import { upgradePostgresLlm } from '../src/lib/server/llmUpgrade';

const url = process.env.TEST_DATABASE_URL;
assert(
	url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439',
	'Use the dedicated disposable LLM test database'
);
// The upgrade rehearsal changes SELECT * row shapes within this one test connection.
const sql = new Bun.SQL(url, { prepare: false });
try {
	const schema = readFileSync(new URL('../src/schema.postgres.sql', import.meta.url), 'utf8');
	await sql.unsafe(schema);
	await sql.unsafe(schema);
	const actor = { id: crypto.randomUUID(), sessionVersion: 0, role: 'ADMIN' } as Account;
	await sql`INSERT INTO admins(id,email,password_hash,role,session_version) VALUES(${actor.id},${`${actor.id}@fixture.test`},'unused','ADMIN',0)`;
	const store = new PostgresLlmStore(sql);
	const settings = {
		...defaultLlmSettings(),
		name: 'PostgreSQL fixture',
		endpoint: 'http://localhost:11434/v1',
		model: 'fixture-model',
		enabled: true
	};
	const id = crypto.randomUUID();
	const first = await store.save(actor, id, null, settings, null, 'remove');
	assert.equal(first.version, 1);
	const state = await store.list(actor);
	await store.select(actor, id, 1, state.selection.version);
	assert.equal((await store.active())?.settings.model, settings.model);
	const beforeUpgrade = await store.list(actor);
	await sql.unsafe('ALTER TABLE llm_configurations DROP COLUMN deleted_at');
	await upgradePostgresLlm(sql);
	await upgradePostgresLlm(sql);
	assert.deepEqual(await store.list(actor), beforeUpgrade);
	const edits = await Promise.allSettled([
		store.save(actor, id, 1, { ...settings, name: 'One' }, null, 'keep'),
		store.save(actor, id, 1, { ...settings, name: 'Two' }, null, 'keep')
	]);
	assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
	assert.equal((await store.audit(actor, id)).length, 3);
	await assert.rejects(
		store.save(actor, crypto.randomUUID(), null, settings, null, 'remove', true),
		/configuration_conflict/
	);
	const beforeFailure = await store.list(actor);
	await sql.unsafe(
		"ALTER TABLE llm_audit ADD CONSTRAINT llm_fixture_failure CHECK (action <> 'update') NOT VALID"
	);
	try {
		await assert.rejects(
			store.save(actor, id, 2, { ...settings, name: 'Must roll back' }, null, 'keep')
		);
		assert.deepEqual(await store.list(actor), beforeFailure);
		assert.equal((await store.audit(actor, id)).length, 3);
	} finally {
		await sql.unsafe('ALTER TABLE llm_audit DROP CONSTRAINT llm_fixture_failure');
	}
	await store.save(actor, id, 2, { ...settings, enabled: false }, null, 'keep');
	assert.equal(await store.active(), undefined);
	assert.equal((await store.list(actor)).selection.activeId, id);
	const other = await store.save(
		actor,
		crypto.randomUUID(),
		null,
		{ ...settings, name: 'Other' },
		'synthetic-encrypted-key',
		'replace'
	);
	const beforeDelete = await store.list(actor);
	await assert.rejects(
		store.remove(actor, id, 2, beforeDelete.selection.version),
		/configuration_conflict/
	);
	await assert.rejects(
		store.remove(actor, id, 3, beforeDelete.selection.version - 1),
		/configuration_conflict/
	);
	await sql.unsafe(
		"ALTER TABLE llm_audit ADD CONSTRAINT llm_delete_fixture_failure CHECK (action <> 'delete') NOT VALID"
	);
	try {
		await assert.rejects(store.remove(actor, id, 3, beforeDelete.selection.version));
		assert.deepEqual(await store.list(actor), beforeDelete);
	} finally {
		await sql.unsafe('ALTER TABLE llm_audit DROP CONSTRAINT llm_delete_fixture_failure');
	}
	const deletes = await Promise.allSettled([
		store.remove(actor, id, 3, beforeDelete.selection.version),
		store.remove(actor, id, 3, beforeDelete.selection.version)
	]);
	assert.equal(deletes.filter((result) => result.status === 'fulfilled').length, 1);
	assert.equal(await store.get(id), undefined);
	assert.equal(await store.active(), undefined);
	const afterDelete = await store.list(actor);
	assert.equal(afterDelete.selection.activeId, null);
	assert.equal(afterDelete.selection.version, beforeDelete.selection.version + 1);
	assert.deepEqual(afterDelete.configurations, [other]);
	assert.equal(afterDelete.established, true);
	assert.equal(
		(await store.audit(actor, id)).filter((entry) => entry.action === 'delete').length,
		1
	);
	await assert.rejects(
		store.save(actor, id, null, settings, null, 'remove'),
		/configuration_conflict/
	);
	await assert.rejects(
		store.select(actor, id, 4, afterDelete.selection.version),
		/configuration_conflict/
	);
	await store.select(actor, other.id, other.version, afterDelete.selection.version);
	const inactive = await store.save(
		actor,
		crypto.randomUUID(),
		null,
		{ ...settings, name: 'Inactive' },
		'synthetic-encrypted-key',
		'replace'
	);
	await store.remove(actor, inactive.id, 1, (await store.list(actor)).selection.version);
	assert.equal((await store.active())?.configuration.id, other.id);
	const [tombstone] =
		await sql`SELECT deleted_at,encrypted_key,version FROM llm_configurations WHERE id=${inactive.id}`;
	assert(tombstone.deleted_at instanceof Date);
	assert.equal(tombstone.encrypted_key, null);
	assert.equal(tombstone.version, 2);
	await sql`UPDATE admins SET session_version=1 WHERE id=${actor.id}`;
	await assert.rejects(store.list(actor), /administrator_required/);
	await assert.rejects(
		store.remove(
			actor,
			other.id,
			other.version,
			(await sql`SELECT version FROM llm_state WHERE id=1`)[0].version
		),
		/administrator_required/
	);
	console.log(
		'PASS PostgreSQL LLM schema upgrade, save, activation, conflicts, audit rollback, import protection, active/inactive deletion, credential removal and session revocation'
	);
} finally {
	await sql.close();
}
