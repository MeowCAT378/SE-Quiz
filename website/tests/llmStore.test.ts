import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { defaultLlmSettings } from '../src/lib/ai/llmConfiguration';
import type { Account } from '../src/lib/server/accounts';
import { D1LlmStore } from '../src/lib/server/llmStoreD1';
import { d1LlmUpgradeStatements } from '../src/lib/server/llmUpgrade';

it('atomically saves, activates, audits and rejects stale/revoked writes in real local D1', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const statements = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8')
			.replace(/--[^\n]*/g, '')
			.split(/;\s*(?=CREATE|$)/i)
			.map((s) => s.trim())
			.filter(Boolean);
		await db.batch(statements.map((s) => db.prepare(s)));
		const actor = { id: crypto.randomUUID(), role: 'ADMIN', sessionVersion: 0 } as Account;
		await db
			.prepare(
				"INSERT INTO admins(id,email,password_hash,role,session_version) VALUES(?,?,'unused','ADMIN',0)"
			)
			.bind(actor.id, 'llm@example.test')
			.run();
		const store = new D1LlmStore(db);
		expect((await store.list(actor)).established).toBe(false);
		const input = {
			...defaultLlmSettings(),
			name: 'Local',
			maxConcurrentOperations: 7,
			model: 'served-model',
			endpoint: 'http://localhost:11434/v1',
			enabled: true
		};
		const imports = await Promise.allSettled([
			store.save(actor, crypto.randomUUID(), null, input, 'encrypted-value', 'replace', true),
			store.save(actor, crypto.randomUUID(), null, input, 'encrypted-value', 'replace', true)
		]);
		const winners = imports.filter((result) => result.status === 'fulfilled');
		expect(winners).toHaveLength(1);
		const id = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof store.save>>>).value
			.id;
		const list = await store.list(actor);
		expect(JSON.stringify(list)).not.toContain('encrypted-value');
		expect(list.established).toBe(true);
		expect(list.configurations[0].hasApiKey).toBe(true);
		expect(await store.active()).toBeUndefined();
		await store.select(actor, id, 1, list.selection.version);
		expect((await store.active())?.settings.model).toBe('served-model');
		expect((await store.active())?.settings.maxConcurrentOperations).toBe(7);
		const edits = await Promise.allSettled([
			store.save(actor, id, 1, { ...input, name: 'One' }, 'encrypted-value', 'keep'),
			store.save(actor, id, 1, { ...input, name: 'Two' }, 'encrypted-value', 'keep')
		]);
		expect(edits.filter((e) => e.status === 'fulfilled')).toHaveLength(1);
		expect(await store.audit(actor, id)).toHaveLength(3);
		await expect(
			store.save(actor, crypto.randomUUID(), null, input, null, 'remove', true)
		).rejects.toThrow('configuration_conflict');
		await db.batch(statements.map((s) => db.prepare(s)));
		expect((await store.list(actor)).configurations).toHaveLength(1);
		const beforeFailure = await store.list(actor);
		await db
			.prepare(
				"CREATE TRIGGER llm_audit_failure BEFORE INSERT ON llm_audit BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
			)
			.run();
		await expect(
			store.save(actor, id, 2, { ...input, name: 'Must roll back' }, 'encrypted-value', 'keep')
		).rejects.toThrow();
		expect(await store.list(actor)).toEqual(beforeFailure);
		expect(await store.audit(actor, id)).toHaveLength(3);
		await db.prepare('DROP TRIGGER llm_audit_failure').run();
		const current = (await store.list(actor)).configurations[0];
		await store.save(
			actor,
			id,
			current.version,
			{ ...input, enabled: false },
			'encrypted-value',
			'keep'
		);
		expect(await store.active()).toBeUndefined();
		expect((await store.list(actor)).selection.activeId).toBe(id);
		await store.select(actor, null, null, (await store.list(actor)).selection.version);
		expect(
			(await store.audit(actor, id)).find((entry) => entry.action === 'deactivate')
				?.configurationVersion
		).toBe(3);
		const beforeDelete = await store.list(actor);
		await store.remove(actor, id, 3, beforeDelete.selection.version);
		expect((await store.list(actor)).configurations).toHaveLength(0);
		expect((await store.list(actor)).established).toBe(true);
		expect(await store.get(id)).toBeUndefined();
		expect(await store.hasEncryptedCredentials()).toBe(false);
		expect(await store.audit(actor, id)).toHaveLength(6);
		await expect(
			store.save(actor, crypto.randomUUID(), null, input, null, 'remove', true)
		).rejects.toThrow('configuration_conflict');
		await db.prepare('UPDATE admins SET session_version=1 WHERE id=?').bind(actor.id).run();
		await expect(store.list(actor)).rejects.toThrow('administrator_required');
		await expect(store.save(actor, id, 3, input, null, 'remove')).rejects.toThrow(
			'administrator_required'
		);
		await expect(store.remove(actor, id, 3, beforeDelete.selection.version)).rejects.toThrow(
			'administrator_required'
		);
	} finally {
		await runtime.dispose();
	}
}, 30000);

it('upgrades existing D1 settings and atomically deletes with history, credentials and selection conflicts', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const schema = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
		const statements = schema
			.replace(/\r?\n deleted_at TEXT,/, '')
			.replace(/--[^\n]*/g, '')
			.split(/;\s*(?=CREATE|$)/i)
			.map((s) => s.trim())
			.filter(Boolean);
		await db.batch(statements.map((s) => db.prepare(s)));
		const actor = { id: crypto.randomUUID(), role: 'ADMIN', sessionVersion: 0 } as Account;
		await db
			.prepare(
				"INSERT INTO admins(id,email,password_hash,role,session_version) VALUES(?,?,'unused','ADMIN',0)"
			)
			.bind(actor.id, 'delete@example.test')
			.run();
		const id = crypto.randomUUID();
		const input = {
			...defaultLlmSettings(),
			name: 'Existing',
			model: 'fixture-model',
			endpoint: 'http://localhost:11434/v1',
			enabled: true
		};
		await db
			.prepare(
				'INSERT INTO llm_configurations(id,settings,encrypted_key,version,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,1,?,?,?,?)'
			)
			.bind(
				id,
				JSON.stringify(input),
				'synthetic-encrypted-key',
				'2026-01-01',
				'2026-01-01',
				actor.id,
				actor.id
			)
			.run();
		const original = await db
			.prepare('SELECT * FROM llm_configurations WHERE id=?')
			.bind(id)
			.first();
		const columns = (
			await db.prepare('PRAGMA table_info(llm_configurations)').all<{ name: string }>()
		).results.map((column) => column.name);
		const upgrades = d1LlmUpgradeStatements(columns);
		expect(upgrades).toHaveLength(1);
		await db.batch(upgrades.map((s) => db.prepare(s)));
		expect(
			await db.prepare('SELECT * FROM llm_configurations WHERE id=?').bind(id).first()
		).toEqual({ ...original, deleted_at: null });
		expect(d1LlmUpgradeStatements([...columns, 'deleted_at'])).toEqual([]);
		expect(d1LlmUpgradeStatements([])).toEqual([]);
		const store = new D1LlmStore(db);
		const other = await store.save(
			actor,
			crypto.randomUUID(),
			null,
			{ ...input, name: 'Other' },
			null,
			'remove'
		);
		let list = await store.list(actor);
		await store.select(actor, id, 1, list.selection.version);
		list = await store.list(actor);
		for (const [configVersion, selectionVersion] of [
			[0, list.selection.version],
			[1, list.selection.version - 1]
		]) {
			await expect(store.remove(actor, id, configVersion, selectionVersion)).rejects.toThrow(
				'configuration_conflict'
			);
			expect(await store.list(actor)).toEqual(list);
		}
		await db
			.prepare(
				"CREATE TRIGGER llm_delete_audit_failure BEFORE INSERT ON llm_audit WHEN NEW.action='delete' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END"
			)
			.run();
		await expect(store.remove(actor, id, 1, list.selection.version)).rejects.toThrow();
		expect(await store.list(actor)).toEqual(list);
		expect((await store.get(id))?.encryptedKey).toBe('synthetic-encrypted-key');
		expect(await store.audit(actor, id)).toHaveLength(1);
		await db.prepare('DROP TRIGGER llm_delete_audit_failure').run();
		// A request already holding a snapshot continues; later snapshots cannot load the deleted config.
		const runningSnapshot = await store.active();
		const deletes = await Promise.allSettled([
			store.remove(actor, id, 1, list.selection.version),
			store.remove(actor, id, 1, list.selection.version)
		]);
		expect(deletes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(runningSnapshot?.settings.model).toBe(input.model);
		expect(await store.active()).toBeUndefined();
		expect(await store.get(id)).toBeUndefined();
		expect(await store.hasEncryptedCredentials()).toBe(false);
		const after = await store.list(actor);
		expect(after.configurations).toEqual([other]);
		expect(after.selection).toEqual({ activeId: null, version: list.selection.version + 1 });
		expect(after.established).toBe(true);
		const tombstone = await db
			.prepare('SELECT deleted_at,encrypted_key,version FROM llm_configurations WHERE id=?')
			.bind(id)
			.first();
		expect(tombstone).toEqual({ deleted_at: expect.any(String), encrypted_key: null, version: 2 });
		const history = await store.audit(actor, id);
		expect(history).toHaveLength(2);
		expect(history.find((entry) => entry.action === 'delete')).toMatchObject({
			configurationVersion: 2,
			changedFields: ['deletedAt', 'apiKey', 'activeId'],
			credentialAction: 'remove'
		});
		await expect(store.save(actor, id, 1, input, null, 'remove')).rejects.toThrow(
			'configuration_conflict'
		);
		await expect(store.save(actor, id, null, input, null, 'remove')).rejects.toThrow(
			'configuration_conflict'
		);
		await expect(store.select(actor, id, 2, after.selection.version)).rejects.toThrow(
			'configuration_conflict'
		);
		await store.select(actor, other.id, other.version, after.selection.version);
		const inactive = await store.save(
			actor,
			crypto.randomUUID(),
			null,
			{ ...input, name: 'Inactive' },
			null,
			'remove'
		);
		list = await store.list(actor);
		const competing = await Promise.allSettled([
			store.remove(actor, inactive.id, 1, list.selection.version),
			store.save(actor, inactive.id, 1, { ...input, name: 'Concurrent edit' }, null, 'keep')
		]);
		expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect((await store.list(actor)).selection.activeId).toBe(other.id);
		expect((await store.active())?.configuration.id).toBe(other.id);
		expect(await store.audit(actor, inactive.id)).toHaveLength(2);
	} finally {
		await runtime.dispose();
	}
}, 30000);
