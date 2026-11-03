import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('$lib/server/privateResourceStore', () => ({
	getPrivateResourceStore: vi.fn(async () => ({ get }))
}));
vi.mock('$lib/server/llmService', () => ({
	loadActivitySnapshot: async (event: any) => {
		if (!event.locals.activityAI) throw new Error('unavailable');
		return {
			provider: event.locals.activityAI,
			settings: {
				batchSize: 3,
				requestTimeoutSeconds: 1,
				generationTimeoutSeconds: 5,
				maxConcurrentOperations: 2
			}
		};
	}
}));

import { POST } from '../src/routes/api/ai/activities/+server';

const user = {
	id: '11111111-1111-4111-8111-111111111111',
	email: 'teacher@example.test',
	role: 'TEACHER',
	sessionVersion: 0,
	createdAt: '',
	deletedAt: null
} as const;
const body = {
	operationId: '22222222-2222-4222-8222-222222222222',
	creationId: '33333333-3333-4333-8333-333333333333',
	activityType: 'word_cloud',
	topic: 'Agile',
	instructions: '',
	itemCount: 1,
	language: 'en'
};

function event(overrides: Record<string, unknown> = {}) {
	return {
		request: new Request('http://localhost/api/ai/activities', {
			method: 'POST',
			headers: { origin: 'http://localhost' },
			body: JSON.stringify(body)
		}),
		url: new URL('http://localhost/api/ai/activities'),
		locals: {
			user,
			session: { userId: user.id, sessionVersion: 0, issuedAt: 1 },
			activityAI: {
				generateStructured: vi.fn(async () => ({
					content: JSON.stringify({ items: [{ prompt: 'One word for Agile?' }] })
				}))
			}
		},
		...overrides
	} as any;
}

beforeEach(() => {
	get.mockReset();
	get.mockResolvedValue({ record: { uniqueId: body.creationId }, createdAt: '', updatedAt: '' });
});

describe('AI activity route authorization', () => {
	it.each([
		11, 30, 0, -1, 1.5
	])('rejects direct API count %s before any provider call', async (itemCount) => {
		const requestEvent = event({
			request: new Request('http://localhost/api/ai/activities', {
				method: 'POST',
				headers: { origin: 'http://localhost' },
				body: JSON.stringify({ ...body, itemCount })
			})
		});
		const response = await POST(requestEvent);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'invalid_request' });
		expect(requestEvent.locals.activityAI.generateStructured).not.toHaveBeenCalled();
	});
	it('rejects unauthenticated and cross-origin requests before generation', async () => {
		const anonymous = event({ locals: {} });
		expect((await POST(anonymous)).status).toBe(401);
		const crossOrigin = event({
			request: new Request('http://localhost/api/ai/activities', {
				method: 'POST',
				headers: { origin: 'http://attacker.test' },
				body: JSON.stringify(body)
			})
		});
		expect((await POST(crossOrigin)).status).toBe(403);
		expect(get).not.toHaveBeenCalled();
	});

	it('requires an owned creation and rechecks it before returning drafts', async () => {
		const response = await POST(event());
		expect(response.status).toBe(200);
		expect(get).toHaveBeenCalledTimes(2);
		expect(await response.json()).toEqual({
			operationId: body.operationId,
			drafts: [{ prompt: 'One word for Agile?' }],
			resolvedLanguage: 'en'
		});
	});

	it('returns the model-selected language for auto requests', async () => {
		const requestEvent = event({
			request: new Request('http://localhost/api/ai/activities', {
				method: 'POST',
				headers: { origin: 'http://localhost' },
				body: JSON.stringify({ ...body, language: 'auto', fallbackLanguage: 'th' })
			})
		});
		requestEvent.locals.activityAI.generateStructured = vi.fn(async () => ({
			content: JSON.stringify({ language: 'ja', items: [{ prompt: 'アジャイルとは？' }] })
		}));
		const response = await POST(requestEvent);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ resolvedLanguage: 'ja' });
	});

	it('returns no drafts when ownership disappears during generation', async () => {
		get
			.mockResolvedValueOnce({ record: { uniqueId: body.creationId } })
			.mockResolvedValueOnce(null);
		const response = await POST(event());
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'creation_not_found' });
	});

	it('does not contact the provider when the creation is unavailable', async () => {
		get.mockResolvedValueOnce(null);
		const requestEvent = event();
		const response = await POST(requestEvent);
		expect(response.status).toBe(404);
		expect(requestEvent.locals.activityAI.generateStructured).not.toHaveBeenCalled();
	});

	it('reports optional AI as unavailable', async () => {
		const requestEvent = event();
		requestEvent.locals.activityAI = undefined;
		expect((await POST(requestEvent)).status).toBe(503);
	});
});
