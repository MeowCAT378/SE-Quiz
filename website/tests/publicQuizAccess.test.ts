import { expect, it, vi } from 'vitest';
import { GET } from '../src/routes/api/quiz/[id]/+server';

const user = { id: '00000000-0000-4000-a000-000000000001', role: 'TEACHER', sessionVersion: 0 };

it('rejects anonymous requests before looking up quiz source data', async () => {
	const get = vi.fn(async () => '{"config":{"title":"private"}}');
	await expect(
		GET({
			params: { id: 'private-key' },
			locals: {
				user: null,
				session: null,
				database: { getById: async () => undefined },
				blobStorage: { get }
			}
		} as never)
	).rejects.toMatchObject({ status: 401 });
	expect(get).not.toHaveBeenCalled();
});

it.each([
	'TEACHER',
	'ADMIN'
] as const)('allows authenticated %s access to published source only', async (role) => {
	const get = vi.fn(async () => '{"config":{"title":"published","slides":[]}}');
	const response = await GET({
		params: { id: 'private-key' },
		locals: {
			user: { ...user, role },
			session: { issuedAt: 0, expiresAt: 1 },
			database: { getById: async () => ({ id: 'private-key', storage_id: 'stored' }) },
			blobStorage: { get }
		}
	} as never);
	expect(response.status).toBe(200);
	expect(get).toHaveBeenCalledWith('stored');
});
