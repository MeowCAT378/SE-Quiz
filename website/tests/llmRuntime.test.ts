import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	active: undefined as any,
	env: {} as Record<string, string>
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('../src/lib/server/llmStoreFactory', () => ({
	getLlmStore: async () => ({ active: async () => state.active })
}));

import { generateActivityDrafts } from '../src/lib/ai/activityGeneration';
import { AIProviderError } from '../src/lib/ai/base';
import { defaultLlmSettings } from '../src/lib/ai/llmConfiguration';
import { legacyLlmPreview, loadActivitySnapshot } from '../src/lib/server/llmService';

beforeEach(() => {
	state.active = {
		configuration: { id: crypto.randomUUID(), version: 1 },
		settings: {
			...defaultLlmSettings(),
			name: 'Local',
			model: 'first',
			endpoint: 'http://localhost:11434/v1',
			enabled: true
		},
		encryptedKey: null
	};
});
it('loads fresh snapshots without changing the settings held by a running operation', async () => {
	const first = await loadActivitySnapshot({} as any);
	state.active.settings = { ...state.active.settings, model: 'second', batchSize: 1 };
	const second = await loadActivitySnapshot({} as any);
	expect(first.settings.model).toBe('first');
	expect(first.settings.batchSize).toBe(3);
	expect(second.settings.model).toBe('second');
	state.active = undefined;
	await expect(loadActivitySnapshot({} as any)).rejects.toThrow('ai_unavailable');
});
it('preserves effective legacy defaults in a safe preview', () => {
	Object.assign(state.env, {
		LLM_BASE_URL: 'http://localhost:11434/v1',
		LLM_MODEL: 'legacy',
		LLM_API_KEY: 'do-not-return'
	});
	const preview = legacyLlmPreview();
	expect(preview.settings?.maxOutputTokens).toBe(2048);
	expect(preview.settings?.temperature).toBe(0.7);
	expect(JSON.stringify(preview)).not.toContain('do-not-return');
	delete state.env.LLM_API_KEY;
});
it('batches 10 items sequentially as 3,3,3,1 and distinguishes attempt deadlines', async () => {
	const sizes: number[] = [];
	let next = 0,
		active = 0;
	const request = {
		activityType: 'word_cloud',
		topic: 'Colors',
		instructions: '',
		language: 'en',
		itemCount: 10
	} as const;
	const provider = {
		async generateStructured({ schema }: any) {
			expect(active++).toBe(0);
			const count = schema.properties.items.minItems;
			sizes.push(count);
			await Promise.resolve();
			active--;
			return {
				content: JSON.stringify({
					items: Array.from({ length: count }, () => ({ prompt: `Color ${next++}` }))
				})
			};
		}
	};
	expect((await generateActivityDrafts(provider, request, { batchSize: 3 })).drafts).toHaveLength(
		10
	);
	expect(sizes).toEqual([3, 3, 3, 1]);
	const slow = {
		async generateStructured({ signal }: any): Promise<never> {
			return new Promise((_, reject) =>
				signal.addEventListener('abort', () => reject(signal.reason), { once: true })
			);
		}
	};
	await expect(
		generateActivityDrafts(slow, request, { callTimeoutMs: 5, maxAttempts: 1 })
	).rejects.toMatchObject({ code: 'request_timeout' });
	const controller = new AbortController();
	controller.abort(new AIProviderError('generation_timeout'));
	await expect(
		generateActivityDrafts(provider, request, { signal: controller.signal })
	).rejects.toMatchObject({ code: 'generation_timeout' });
});

it('uses the saved endpoint without an environment allowlist and keeps one snapshot through every batch', async () => {
	const first = await loadActivitySnapshot({} as any);
	const bodies: { model: string; count: number }[] = [];
	const paths: string[] = [];
	const { createServer } = await import('node:http');
	const server = createServer(async (req, res) => {
		let raw = '';
		for await (const chunk of req) raw += chunk;
		const input = JSON.parse(raw),
			count = input.response_format.json_schema.schema.properties.items.minItems;
		bodies.push({ model: input.model, count });
		paths.push(req.url ?? '');
		if (bodies.length === 1)
			state.active.settings = {
				...state.active.settings,
				endpoint: `${state.active.settings.endpoint}/next`,
				model: 'second',
				batchSize: 1
			};
		res.end(
			JSON.stringify({
				choices: [
					{
						finish_reason: 'stop',
						message: {
							content: JSON.stringify({
								items: Array.from({ length: count }, (_, i) => ({
									prompt: `Batch ${bodies.length} prompt ${i}`
								}))
							})
						}
					}
				]
			})
		);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
	state.active.settings.endpoint = endpoint;
	try {
		const snapshot = await loadActivitySnapshot({} as any);
		const request = {
			activityType: 'word_cloud',
			topic: 'Colors',
			instructions: '',
			language: 'en',
			itemCount: 10
		} as const;
		expect(
			(
				await generateActivityDrafts(snapshot.provider, request, {
					batchSize: snapshot.settings.batchSize
				})
			).drafts
		).toHaveLength(10);
		expect(bodies).toEqual([3, 3, 3, 1].map((count) => ({ model: 'first', count })));
		expect(paths).toEqual(Array(4).fill('/v1/chat/completions'));
		const next = await loadActivitySnapshot({} as any);
		expect(next.settings.model).toBe('second');
		expect(next.settings.batchSize).toBe(1);
		await generateActivityDrafts(next.provider, { ...request, itemCount: 1 });
		expect(paths.at(-1)).toBe('/v1/next/chat/completions');
		state.active.settings.enabled = false;
		await expect(loadActivitySnapshot({} as any)).rejects.toThrow('ai_unavailable');
		expect(snapshot.settings.enabled).toBe(true);
		expect(first.settings.model).toBe('first');
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it('preserves unreadable credentials while allowing disable, and prevents key reuse at a changed destination', async () => {
	const { resolveLlmCredential } = await import('../src/lib/server/llmService');
	const settings = state.active.settings;
	const previous = { ...state.active, encryptedKey: 'unreadable-ciphertext' };
	const disabled = await resolveLlmCredential(
		{ platform: undefined },
		previous.configuration.id,
		{ ...settings, enabled: false },
		{ action: 'keep' },
		previous,
		true
	);
	expect(disabled.encryptedKey).toBe('unreadable-ciphertext');
	for (const action of ['keep', 'remove', 'replace'])
		await expect(
			resolveLlmCredential(
				{ platform: undefined },
				previous.configuration.id,
				settings,
				{ action, value: 'replacement' },
				previous,
				true
			)
		).rejects.toThrow('credential_unavailable');
	await expect(
		resolveLlmCredential(
			{ platform: undefined },
			previous.configuration.id,
			{ ...settings, endpoint: 'http://elsewhere/v1', enabled: false },
			{ action: 'keep' },
			previous,
			true
		)
	).rejects.toThrow('credential_destination_changed');
	expect(
		(
			await resolveLlmCredential(
				{ platform: undefined },
				'keyless',
				settings,
				{ action: 'remove' },
				undefined,
				true
			)
		).encryptedKey
	).toBeNull();
});
