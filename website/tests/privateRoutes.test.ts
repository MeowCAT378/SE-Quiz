import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, expect, it, vi } from 'vitest';
import { getPrivateResourceStore } from '../src/lib/server/privateResourceStore';
import { PrivateResourceStore } from '../src/lib/server/privateResources';
import {
	gameExportRoute,
	importRoute,
	mediaRoute,
	resourceRoute
} from '../src/lib/server/privateRoutes';
import { privateRecordBytes } from './privateResourceSizeFixtures';

class BoundaryStore extends PrivateResourceStore {
	protected readonly jsonValues = '';
	protected async query(): Promise<never> {
		throw new Error('Oversized records must not reach the database');
	}
	protected async atomic(): Promise<never> {
		throw new Error('Oversized records must not mutate the database');
	}
}

vi.mock('../src/lib/server/privateResourceStore', () => ({ getPrivateResourceStore: vi.fn() }));
const id = '00000000-0000-4000-a000-000000000001';
function event(
	method = 'GET',
	data?: unknown,
	role: 'ADMIN' | 'TEACHER' | null = 'TEACHER',
	origin = 'http://localhost'
) {
	return {
		request: new Request(`http://localhost/api/creations/${id}`, {
			method,
			headers: { origin, 'content-type': 'application/json' },
			...(data ? { body: JSON.stringify(data) } : {})
		}),
		url: new URL('http://localhost/api/creations'),
		locals: {
			user: role ? { id, role, sessionVersion: 0 } : null,
			session: role ? { issuedAt: 0, expiresAt: 9999999999999 } : null
		},
		params: { uuid: id, id }
	} as unknown as RequestEvent;
}
beforeEach(() => vi.mocked(getPrivateResourceStore).mockResolvedValue(undefined));
it('returns permanent 413 before persistence for an oversized canonical resource body', async () => {
	vi.mocked(getPrivateResourceStore).mockResolvedValue(new BoundaryStore());
	const response = await resourceRoute(
		event('POST', privateRecordBytes('creation', 1_900_001)),
		'creation'
	);
	expect(response.status).toBe(413);
	expect(response.headers.get('cache-control')).toBe('no-store');
});
it('independently denies anonymous CRUD/media and teacher import before provider lookup', async () => {
	for (const handler of [
		() => resourceRoute(event('GET', undefined, null), 'creation'),
		() => mediaRoute(event('GET', undefined, null)),
		() => importRoute(event('POST', {}, 'TEACHER'))
	]) {
		const response = await handler();
		expect([401, 403]).toContain(response.status);
		expect(response.headers.get('cache-control')).toBe('no-store');
	}
});
it('denies cross-origin writes and fails closed when the provider is absent', async () => {
	expect(
		(await resourceRoute(event('POST', {}, 'TEACHER', 'https://foreign.test'), 'creation')).status
	).toBe(403);
	expect((await resourceRoute(event(), 'creation')).status).toBe(503);
});
it('checks current account and immutable game instance for unsaved report export', async () => {
	const request = event();
	request.params.id = id;
	vi.mocked(getPrivateResourceStore).mockResolvedValue({
		gameForExport: async () => null
	} as never);
	expect((await gameExportRoute(request)).status).toBe(404);
	expect((await gameExportRoute(event('GET', undefined, null))).status).toBe(401);
});
it('rejects forged update envelopes and body/path UUID disagreement', async () => {
	vi.mocked(getPrivateResourceStore).mockResolvedValue({} as never);
	expect(
		(
			await resourceRoute(
				event('PUT', { record: { uniqueId: id }, expectedVersion: 0, ownerId: id }),
				'creation',
				id
			)
		).status
	).toBe(400);
	expect(
		(
			await resourceRoute(
				event('PUT', {
					record: { uniqueId: '00000000-0000-4000-a000-000000000002' },
					expectedVersion: 0
				}),
				'creation',
				id
			)
		).status
	).toBe(400);
});
