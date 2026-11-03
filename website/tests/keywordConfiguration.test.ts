import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ load: vi.fn(), generate: vi.fn() }));
vi.mock('../src/lib/server/llmService', () => ({ loadActivitySnapshot: state.load }));

import { beginActivityOperation, finishActivityOperation } from '../src/lib/ai/activityOperations';
import { createAI } from '../src/lib/ai/factory';

it('uses the ADMIN snapshot for optional keywords with shared limits and strict validation', async () => {
	const event = {
		locals: { user: { id: 'keyword-owner' }, session: { issuedAt: 1 } },
		request: new Request('http://localhost')
	} as any;
	state.load.mockResolvedValue({
		settings: {
			maxConcurrentOperations: 2,
			requestTimeoutSeconds: 30,
			generationTimeoutSeconds: 60
		},
		provider: { generateStructured: state.generate }
	});
	state.generate.mockResolvedValue({ content: '{"keywords":[" quiz ","quiz","Thai"]}' });
	const ai = await createAI(event);
	expect(state.load).toHaveBeenCalledWith(event);
	expect(await ai?.generateKeywords('prompt', 'content')).toBe('["quiz","Thai"]');
	expect(state.generate.mock.calls[0][0]).toMatchObject({
		systemPrompt: 'prompt',
		userContent: 'content'
	});
	for (const content of [
		'{broken',
		'{"keywords":[1]}',
		'{"keywords":[]}',
		'{"keywords":["valid"],"extra":true}',
		JSON.stringify({ keywords: ['x'.repeat(101)] })
	]) {
		state.generate.mockResolvedValue({ content });
		expect(await ai?.generateKeywords('prompt', 'content')).toBeNull();
	}
	const operation = beginActivityOperation('held', 'keyword-owner:1', 2);
	if (!operation) throw new Error('Fixture operation was not admitted');
	try {
		state.generate.mockClear();
		expect(await ai?.generateKeywords('prompt', 'content')).toBeNull();
		expect(state.generate).not.toHaveBeenCalled();
	} finally {
		finishActivityOperation(operation);
	}
	const controller = new AbortController();
	controller.abort();
	state.generate.mockResolvedValue({ content: '{"keywords":["valid"]}' });
	const cancelled = await createAI({
		...event,
		request: new Request('http://localhost', { signal: controller.signal })
	});
	expect(await cancelled?.generateKeywords('prompt', 'content')).toBeNull();
	state.load.mockRejectedValue(new Error('ai_unavailable'));
	expect(await createAI(event)).toBeUndefined();
});
