import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleAI } from '../src/lib/ai/openai';

afterEach(() => vi.unstubAllGlobals());

const schema = {
	type: 'object',
	additionalProperties: false,
	required: ['items'],
	properties: { items: { type: 'array', items: { type: 'string' } } }
};

describe('OpenAI-compatible structured output', () => {
	it('uses the exact configured model and returns only final content', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [
						{ finish_reason: 'stop', message: { content: '{"items":[]}', reasoning: 'private' } }
					],
					usage: { prompt_tokens: 10, completion_tokens: 4 }
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OpenAICompatibleAI('http://example.test/v1', undefined, 'served-id');

		const result = await provider.generateStructured({
			systemPrompt: 'system',
			userContent: 'user',
			schema,
			signal: new AbortController().signal
		});

		expect(result.content).toBe('{"items":[]}');
		expect(result).not.toHaveProperty('reasoning');
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.model).toBe('served-id');
		expect(body.stream).toBe(false);
		expect(body.response_format).toEqual({
			type: 'json_schema',
			json_schema: { name: 'activity_items', strict: true, schema }
		});
	});

	it.each([
		[{ choices: [{ finish_reason: 'stop', message: { content: '' } }] }, 'empty_response'],
		[
			{ choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] },
			'invalid_response'
		],
		[
			{ choices: [{ finish_reason: 'length', message: { content: '{"items":[]}' } }] },
			'truncated_response'
		],
		[
			{
				choices: [
					{ finish_reason: 'stop', message: { content: null, reasoning: 'only reasoning' } }
				]
			},
			'empty_response'
		],
		[
			{ choices: [{ finish_reason: 'tool_calls', message: { content: '{}', tool_calls: [{}] } }] },
			'unexpected_tool_call'
		]
	])('rejects unsafe response envelopes', async (payload, code) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
		const provider = new OpenAICompatibleAI('http://example.test/v1', undefined, 'served-id');
		await expect(
			provider.generateStructured({ systemPrompt: 's', userContent: 'u', schema })
		).rejects.toMatchObject({ code });
	});

	it('does not expose a provider error body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('secret provider details', { status: 401 }))
		);
		const provider = new OpenAICompatibleAI('http://example.test/v1', 'secret', 'served-id');
		await expect(
			provider.generateStructured({ systemPrompt: 's', userContent: 'u', schema })
		).rejects.toMatchObject({ code: 'authentication_failed', message: 'authentication_failed' });
	});

	it('reports aborted provider calls as cancellation', async () => {
		const controller = new AbortController();
		controller.abort();
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
		const provider = new OpenAICompatibleAI('http://example.test/v1', undefined, 'served-id');
		await expect(
			provider.generateStructured({
				systemPrompt: 's',
				userContent: 'u',
				schema,
				signal: controller.signal
			})
		).rejects.toMatchObject({ code: 'cancelled' });
	});

	it('keeps legacy keyword-generation failures free of provider response bodies', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('secret provider details', { status: 500 }))
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const provider = new OpenAICompatibleAI('http://example.test/v1', undefined, 'served-id');
		expect(await provider.generateKeywords('system', 'user')).toBeNull();
		expect(JSON.stringify(error.mock.calls)).not.toContain('secret provider details');
		error.mockRestore();
	});
});
