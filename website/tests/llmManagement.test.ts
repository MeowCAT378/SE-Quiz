import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ store: undefined as any, env: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: fixture.env }));
vi.mock('../src/lib/server/llmStoreFactory', () => ({ getLlmStore: async () => fixture.store }));

import { createAI } from '../src/lib/ai/factory';
import { defaultLlmSettings } from '../src/lib/ai/llmConfiguration';
import { D1LlmStore } from '../src/lib/server/llmStoreD1';
import { GET } from '../src/routes/api/admin/llm/+server';
import { POST } from '../src/routes/api/admin/llm/[action]/+server';

it('lets ADMIN manage endpoints and encrypted credentials without LLM environment settings', async () => {
	const calls: { model: string; tokenLimit: number; authorization?: string }[] = [];
	let redirect = false;
	let invalidOutput = false;
	const provider = createServer(async (req, res) => {
		if (redirect) {
			res.writeHead(307, { location: '/secret-destination' });
			res.end();
			return;
		}
		if (invalidOutput) {
			res.end(
				JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] })
			);
			return;
		}
		if (req.url === '/v1/models') {
			res.end(JSON.stringify({ data: [{ id: 'served-model' }] }));
			return;
		}
		let body = '';
		for await (const chunk of req) body += chunk;
		const input = JSON.parse(body);
		calls.push({
			model: input.model,
			tokenLimit: input.max_tokens,
			authorization: req.headers.authorization
		});
		res.end(
			JSON.stringify({
				choices: [
					{
						finish_reason: 'stop',
						message: {
							content: JSON.stringify(
								input.response_format.json_schema.schema.properties.keywords
									? { keywords: ['quiz', 'arithmetic'] }
									: {
											items: [
												{
													question: 'What is 1 + 1?',
													choices: ['2', '3'],
													correctIndex: 0,
													difficulty: 'easy'
												}
											]
										}
							)
						}
					}
				]
			})
		);
	});
	await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
	const address = provider.address() as { port: number };
	const endpoint = `http://127.0.0.1:${address.port}/v1`;
	const storage = await mkdtemp(join(tmpdir(), 'llm-management-'));
	fixture.env.STORAGE_PATH = storage;
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
		const actor = { id: crypto.randomUUID(), role: 'ADMIN', sessionVersion: 0 };
		await db
			.prepare(
				"INSERT INTO admins(id,email,password_hash,role,session_version) VALUES(?,?,'unused','ADMIN',0)"
			)
			.bind(actor.id, 'manager@example.test')
			.run();
		fixture.store = new D1LlmStore(db);
		const event = (action: string, body: unknown) =>
			({
				params: { action },
				url: new URL('http://localhost'),
				locals: { user: actor, session: { issuedAt: 1 } },
				request: new Request(`http://localhost/api/admin/llm/${action}`, {
					method: 'POST',
					headers: { origin: 'http://localhost' },
					body: JSON.stringify(body)
				})
			}) as any;
		const settings = {
			...defaultLlmSettings(),
			name: 'Fixture',
			endpoint,
			model: 'saved-model',
			enabled: true
		};
		for (const forbidden of ['http://169.254.169.254/v1', 'http://metadata.google.internal/v1']) {
			const rejected = await POST(
				event('save', {
					id: null,
					expectedVersion: null,
					settings: { ...settings, endpoint: forbidden },
					credential: { action: 'remove' }
				})
			);
			expect((await rejected.json()).error).toBe('destination_not_allowed');
		}
		expect((await fixture.store.list(actor)).configurations).toHaveLength(0);
		const create = await POST(
			event('save', {
				id: null,
				expectedVersion: null,
				settings,
				credential: { action: 'replace', value: 'synthetic-fixture-key' }
			})
		);
		expect(create.status).toBe(200);
		const saved = (await create.json()).configuration;
		expect(saved.hasApiKey).toBe(true);
		expect(JSON.stringify(saved)).not.toContain('synthetic-fixture-key');
		const row = await fixture.store.get(saved.id);
		expect(row.encryptedKey).not.toContain('synthetic-fixture-key');
		expect(await fixture.store.hasEncryptedCredentials()).toBe(true);
		const secret = readFileSync(join(storage, '.llm-secrets', 'encryption.key'), 'utf8');
		expect(Buffer.from(secret, 'base64')).toHaveLength(32);
		expect(JSON.stringify(saved)).not.toContain(secret);
		// A fresh store uses the persisted key rather than process-local state.
		fixture.store = new D1LlmStore(db);
		const input = {
			id: saved.id,
			expectedVersion: saved.version,
			settings,
			credential: { action: 'keep' }
		};
		const tested = await POST(
			event('test', {
				...input,
				settings: { ...settings, model: 'unsaved-model', maxOutputTokens: 2048 }
			})
		);
		expect(tested.status).toBe(200);
		expect(calls).toEqual([
			{ model: 'unsaved-model', tokenLimit: 2048, authorization: 'Bearer synthetic-fixture-key' }
		]);
		expect((await fixture.store.get(saved.id)).settings.model).toBe('saved-model');
		expect(await fixture.store.active()).toBeUndefined();
		const selection = await fixture.store.list(actor);
		await fixture.store.select(actor, saved.id, saved.version, selection.selection.version);
		const ai = await createAI(event('', {}));
		expect(await ai?.generateKeywords('Keywords', 'Arithmetic quiz')).toBe('["quiz","arithmetic"]');
		expect(calls.at(-1)).toEqual({
			model: 'saved-model',
			tokenLimit: settings.maxOutputTokens,
			authorization: 'Bearer synthetic-fixture-key'
		});
		const changed = await POST(
			event('test', { ...input, settings: { ...settings, endpoint: `${endpoint}/other` } })
		);
		expect(changed.status).toBe(400);
		expect(calls).toHaveLength(2);
		const discovered = await POST(
			event('models', { ...input, settings: { ...settings, model: '' } })
		);
		expect((await discovered.json()).models).toEqual(['served-model']);
		redirect = true;
		expect((await POST(event('test', input))).status).toBe(400);
		expect(calls).toHaveLength(2);
		redirect = false;
		invalidOutput = true;
		const invalid = await POST(event('test', input));
		expect(invalid.status).toBe(422);
		expect((await invalid.json()).error).toBe('invalid_response');
		invalidOutput = false;
		const list = await GET(event('', {}));
		expect(JSON.stringify(await list.json())).not.toContain('synthetic-fixture-key');
		const removed = await POST(event('save', { ...input, credential: { action: 'remove' } }));
		expect((await removed.json()).configuration.hasApiKey).toBe(false);
		expect((await fixture.store.get(saved.id)).encryptedKey).toBeNull();
		expect(await fixture.store.hasEncryptedCredentials()).toBe(false);
		expect((await POST(event('save', input))).status).toBe(409);
		const beforeDelete = await fixture.store.list(actor);
		const deletion = {
			id: saved.id,
			expectedVersion: saved.version + 1,
			expectedSelectionVersion: beforeDelete.selection.version
		};
		for (const invalid of [
			{ ...deletion, id: null },
			{ ...deletion, id: 'invalid' },
			{ ...deletion, expectedVersion: null },
			{ ...deletion, expectedSelectionVersion: null },
			{ ...deletion, expectedVersion: -1 }
		]) {
			expect((await POST(event('delete', invalid))).status).toBe(400);
		}
		const staleDelete = await POST(
			event('delete', { ...deletion, expectedVersion: saved.version })
		);
		expect(staleDelete.status).toBe(409);
		expect(await fixture.store.list(actor)).toEqual(beforeDelete);
		const deleted = await POST(event('delete', deletion));
		expect(deleted.status).toBe(200);
		expect(deleted.headers.get('cache-control')).toBe('no-store');
		expect(await deleted.json()).toEqual({ deleted: true });
		expect((await fixture.store.list(actor)).configurations).toHaveLength(0);
		expect((await fixture.store.list(actor)).selection.activeId).toBeNull();
		expect(await createAI(event('', {}))).toBeUndefined();
		expect((await POST(event('delete', deletion))).status).toBe(409);
	} finally {
		await runtime.dispose();
		provider.closeAllConnections();
		await new Promise<void>((resolve) => provider.close(() => resolve()));
		await rm(storage, { recursive: true, force: true });
		delete fixture.env.STORAGE_PATH;
	}
}, 30000);
