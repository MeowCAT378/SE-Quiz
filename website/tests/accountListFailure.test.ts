import { expect, it, vi } from 'vitest';

const list = vi.hoisted(() =>
	vi.fn<() => Promise<Array<{ id: string; deletedAt: string | null }>>>(async () => {
		throw new Error('sentinel-account-error');
	})
);

vi.mock('$lib/server/accountStore', () => ({
	getAccountStore: async () => ({
		list
	})
}));

import { load } from '../src/routes/[[lang=locale]]/admin/users/+page.server';
import { GET } from '../src/routes/api/admin/users/+server';

it.each([GET, load])('maps account list provider failures to generic 503', async (handler) => {
	const event = {
		locals: { user: { id: 'admin', role: 'ADMIN', sessionVersion: 0 }, session: {} },
		setHeaders: vi.fn()
	};
	await expect(handler(event as never)).rejects.toMatchObject({
		status: 503,
		body: { message: 'Account service unavailable' }
	});
});

it('hides deleted accounts from the user management page', async () => {
	list.mockResolvedValueOnce([
		{ id: 'active', deletedAt: null },
		{ id: 'deleted', deletedAt: '2026-09-21T00:00:00.000Z' }
	]);
	const result = await load({
		locals: { user: { id: 'admin', role: 'ADMIN', sessionVersion: 0 }, session: {} },
		setHeaders: vi.fn()
	} as never);
	expect(result).toMatchObject({ users: [{ id: 'active' }], currentUserId: 'admin' });
});
