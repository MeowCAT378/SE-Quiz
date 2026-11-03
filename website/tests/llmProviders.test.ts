import { describe, expect, it } from 'vitest';
import { generateActivityDrafts } from '../src/lib/ai/activityGeneration';
import { AIProviderError } from '../src/lib/ai/base';
import { defaultLlmSettings, type LlmProvider } from '../src/lib/ai/llmConfiguration';
import { createLlmProvider } from '../src/lib/server/llmProviders';

describe('activity provider protocol contracts', () => {
	it.each([
		'claude',
		'gemini'
	] as const)('adapts the generated Slider schema to %s without weakening application validation', async (provider) => {
		const draft = {
			question: 'Estimate',
			range: { min: 0, max: 100, step: 2 },
			correct: 50,
			tolerance: 0,
			unit: '%',
			difficulty: 'easy'
		};
		const adapter = createLlmProvider(
			{ ...defaultLlmSettings(), provider, model: 'manual', topP: null },
			undefined,
			async (_path, init) => {
				const body = JSON.parse(String(init.body));
				const schema =
					provider === 'claude'
						? body.output_config.format.schema
						: body.generationConfig.responseJsonSchema;
				const step = schema.properties.items.items.properties.range.properties.step;
				expect(step).not.toHaveProperty('exclusiveMinimum');
				expect(step.description).toContain('exclusiveMinimum: 0');
				const content = JSON.stringify({ items: [draft] });
				return Response.json(
					provider === 'claude'
						? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }
						: { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] }
				);
			}
		);
		expect(
			(
				await generateActivityDrafts(adapter, {
					activityType: 'slider',
					topic: 'Measurements',
					instructions: '',
					itemCount: 1,
					language: 'en',
					difficulty: 'easy'
				})
			).drafts
		).toEqual([draft]);
		draft.range.step = 0;
		await expect(
			generateActivityDrafts(adapter, {
				activityType: 'slider',
				topic: 'Measurements',
				instructions: '',
				itemCount: 1,
				language: 'en',
				difficulty: 'easy'
			})
		).rejects.toThrow();
	});
	for (const provider of [
		'ollama',
		'vllm',
		'openai',
		'custom',
		'gemini',
		'claude'
	] as LlmProvider[]) {
		it(`uses ${provider} authentication, tokens, schema and strict completion`, async () => {
			const calls: { path: string; init: RequestInit }[] = [];
			const content = '{"items":[{"prompt":"Name a color"}]}';
			const transport = async (path: string, init: RequestInit) => {
				calls.push({ path, init });
				return Response.json(
					provider === 'claude'
						? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }
						: provider === 'gemini'
							? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] }
							: { choices: [{ message: { content }, finish_reason: 'stop' }] }
				);
			};
			const config = {
				...defaultLlmSettings(),
				provider,
				endpoint: 'https://example.test/v1',
				model: 'manual-model',
				topP: provider === 'claude' ? null : 0.95
			};
			const adapter = createLlmProvider(config, 'secret', transport);
			expect(
				(
					await adapter.generateStructured({
						systemPrompt: 'system',
						userContent: 'user',
						schema: {
							type: 'object',
							properties: { count: { type: 'integer', minimum: 1 } },
							additionalProperties: false
						}
					})
				).content
			).toBe(content);
			const body = JSON.parse(String(calls[0].init.body));
			const headers = new Headers(calls[0].init.headers);
			expect(
				headers.get(
					provider === 'claude'
						? 'x-api-key'
						: provider === 'gemini'
							? 'x-goog-api-key'
							: 'authorization'
				)
			).toBe(provider === 'claude' || provider === 'gemini' ? 'secret' : 'Bearer secret');
			expect(
				provider === 'gemini'
					? body.generationConfig.maxOutputTokens
					: body[provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']
			).toBe(4096);
			if (provider === 'claude')
				expect(body.output_config.format.schema.properties.count.minimum).toBeUndefined();
		});
	}
	it('classifies auth, model, rate limits and truncated responses without provider bodies', async () => {
		for (const [status, code] of [
			[401, 'authentication_failed'],
			[404, 'model_unavailable'],
			[429, 'rate_limited']
		] as const) {
			const adapter = createLlmProvider(
				{ ...defaultLlmSettings(), provider: 'gemini', model: 'manual' },
				'key',
				async () => new Response('sensitive body', { status })
			);
			await expect(
				adapter.generateStructured({ systemPrompt: '', userContent: '', schema: {} })
			).rejects.toMatchObject({ code });
		}
		const adapter = createLlmProvider(
			{ ...defaultLlmSettings(), provider: 'claude', model: 'manual', topP: null },
			'key',
			async () =>
				Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] })
		);
		await expect(
			adapter.generateStructured({ systemPrompt: '', userContent: '', schema: {} })
		).rejects.toBeInstanceOf(AIProviderError);
	});
});

it('normalizes malformed native-provider payloads without returning raw bodies', async () => {
	for (const provider of ['gemini', 'claude'] as const) {
		for (const body of [
			null,
			{},
			{ stop_reason: 'end_turn', content: [null] },
			{ candidates: [{ finishReason: 'STOP', content: { parts: [null] } }] }
		]) {
			const adapter = createLlmProvider(
				{ ...defaultLlmSettings(), provider, model: 'manual', topP: null },
				'key',
				async () => Response.json(body)
			);
			await expect(
				adapter.generateStructured({ systemPrompt: '', userContent: '', schema: {} })
			).rejects.toBeInstanceOf(AIProviderError);
		}
	}
});
