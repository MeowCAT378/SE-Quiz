import type { SQL } from 'bun';
import { describe, expect, it, vi } from 'vitest';
import { defaultLlmSettings } from '../src/lib/ai/llmConfiguration';
import type { Account } from '../src/lib/server/accounts';
import { PostgresLlmStore } from '../src/lib/server/llmStorePostgres';

describe('PostgreSQL LLM timestamp compatibility', () => {
	const instant = '2026-10-05T01:02:03.456Z';
	const actor = { id: crypto.randomUUID(), role: 'ADMIN', sessionVersion: 0 } as Account;
	const id = crypto.randomUUID();
	const settings = {
		...defaultLlmSettings(),
		name: 'Timestamp fixture',
		endpoint: 'http://localhost:11434/v1',
		model: 'fixture'
	};

	it.each([
		instant,
		new Date(instant)
	])('returns the same public ISO timestamp for %s', async (time) => {
		const sql = {
			unsafe: vi.fn(async () => [
				{
					id,
					settings: JSON.stringify(settings),
					encrypted_key: null,
					version: 1,
					created_at: time,
					updated_at: time,
					created_by: actor.id,
					updated_by: actor.id
				}
			])
		} as unknown as SQL;
		const result = await new PostgresLlmStore(sql).get(id);
		expect(result?.configuration.createdAt).toBe(instant);
		expect(result?.configuration.updatedAt).toBe(instant);
		expect(result?.settings).toEqual(settings);
	});

	it('keeps audit timestamps and fields compatible after the database changes type', async () => {
		const sql = {
			unsafe: vi.fn(async (query: string) =>
				query.includes('FROM admins')
					? [{ id: actor.id }]
					: [
							{
								id: 'audit',
								configuration_id: id,
								configuration_version: 2,
								actor_id: actor.id,
								created_at: new Date(instant),
								action: 'update',
								changed_fields: '["name"]',
								credential_action: 'keep'
							}
						]
			)
		} as unknown as SQL;
		const [entry] = await new PostgresLlmStore(sql).audit(actor, id);
		expect(entry.createdAt).toBe(instant);
		expect(entry.changedFields).toEqual(['name']);
		expect(entry.configurationVersion).toBe(2);
	});
});
