import { beforeEach, expect, it, vi } from 'vitest';

const revoke = vi.hoisted(() => vi.fn(async () => true));
vi.mock('$env/dynamic/private', () => ({ env: { ADMIN_SESSION_SECRET: 'logout-test-key' } }));
vi.mock('$lib/server/accountStore', () => ({
	getAccountStore: async () => ({ revokeSessions: revoke })
}));

import { createSessionToken } from '../src/lib/server/auth';
import { actions } from '../src/routes/[[lang=locale]]/logout/+page.server';

beforeEach(() => revoke.mockReset().mockResolvedValue(true));

const event = (origin: string) =>
	({
		url: new URL('http://localhost/logout'),
		request: new Request('http://localhost/logout', { method: 'POST', headers: { origin } }),
		locals: { user: { id: 'u', sessionVersion: 3 }, session: { expiresAt: Date.now() + 10000 } },
		cookies: { get: vi.fn(() => undefined), delete: vi.fn() }
	}) as unknown as Parameters<typeof actions.default>[0];
it('revokes all account sessions before clearing cookies', async () => {
	const request = event('http://localhost');
	await expect(actions.default(request)).rejects.toMatchObject({ status: 303 });
	expect(revoke).toHaveBeenCalledWith('u', 3);
	expect(request.cookies.delete).toHaveBeenCalledWith('admin_session', { path: '/' });
});
it('does not confirm global logout when a signed session survives a failed account lookup', async () => {
	const request = event('http://localhost');
	request.locals.user = null;
	request.locals.session = null;
	const identity = { id: '11111111-1111-4111-8111-111111111111', sessionVersion: 3 };
	vi.mocked(request.cookies.get).mockReturnValue(createSessionToken(identity));
	revoke.mockRejectedValueOnce(new Error('provider unavailable'));
	const result = await actions.default(request);
	expect(result).toMatchObject({ status: 503, data: { unavailable: true } });
	expect(revoke).toHaveBeenCalledWith(identity.id, identity.sessionVersion);
	expect(request.cookies.delete).toHaveBeenCalledWith('admin_session', { path: '/' });
});
it('can revoke a signed identity when authoritative lookup did not populate locals', async () => {
	const request = event('http://localhost');
	request.locals.user = null;
	request.locals.session = null;
	const identity = { id: '11111111-1111-4111-8111-111111111111', sessionVersion: 3 };
	vi.mocked(request.cookies.get).mockReturnValue(createSessionToken(identity));
	await expect(actions.default(request)).rejects.toMatchObject({ status: 303 });
	expect(revoke).toHaveBeenCalledWith(identity.id, identity.sessionVersion);
});
it('clears an invalid anonymous cookie without claiming account revocation', async () => {
	const request = event('http://localhost');
	request.locals.user = null;
	request.locals.session = null;
	vi.mocked(request.cookies.get).mockReturnValue('invalid');
	await expect(actions.default(request)).rejects.toMatchObject({ status: 303 });
	expect(revoke).not.toHaveBeenCalled();
});
it('rejects cross-origin logout before account mutation', async () => {
	revoke.mockClear();
	await expect(actions.default(event('http://attacker.test'))).rejects.toMatchObject({
		status: 403
	});
	expect(revoke).not.toHaveBeenCalled();
});
