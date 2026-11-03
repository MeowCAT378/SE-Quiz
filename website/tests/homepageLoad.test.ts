import { describe, expect, it } from 'vitest';
import { load } from '../src/routes/[[lang=locale]]/+page.server';

describe('home page load', () => {
	it('provides the signed-in user to the header without session metadata', async () => {
		const result = await load({
			locals: {
				user: {
					id: 'admin',
					email: 'admin@example.test',
					role: 'ADMIN',
					createdAt: '2026-09-17T00:00:00Z',
					deletedAt: null,
					sessionVersion: 7
				},
				isAdmin: true,
				database: {
					getRecentlyPublished: async () => [],
					getActiveGames: async () => []
				}
			}
		} as never);

		expect(result.user).toEqual({
			id: 'admin',
			email: 'admin@example.test',
			role: 'ADMIN',
			createdAt: '2026-09-17T00:00:00Z',
			deletedAt: null
		});
	});
});
