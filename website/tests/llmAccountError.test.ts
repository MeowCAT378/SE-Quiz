import { afterEach, expect, it, vi } from 'vitest';
import { type AccountBinding, accountRequest } from '../src/lib/storage/account';

afterEach(() => vi.unstubAllGlobals());
it('rechecks account binding before exposing a safe AI error code', async () => {
	let current = 'first';
	const binding = {
		user: { id: 'first', role: 'TEACHER' },
		sessionIssuedAt: 1,
		closed: false,
		close() {
			this.closed = true;
		}
	} as AccountBinding;
	vi.stubGlobal('fetch', async (url: string) => {
		if (url === '/api/account') return Response.json({ user: { id: current }, sessionIssuedAt: 1 });
		current = 'second';
		return Response.json({ error: 'generation_timeout' }, { status: 504 });
	});
	await expect(accountRequest(binding, '/api/ai/activities')).rejects.toMatchObject({
		status: 401,
		code: undefined
	});
});
