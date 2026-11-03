import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ADMIN_SESSION_SECRET: 'test-only-notification',
		GAME_SERVER_INTERNAL_URL: 'http://runtime.test'
	}
}));
const store = vi.hoisted(() => ({
	update: vi.fn(),
	softDelete: vi.fn(),
	findByEmail: vi.fn(),
	revokeSessions: vi.fn()
}));
vi.mock('$lib/server/accountStore', () => ({ getAccountStore: async () => store }));

import { verifyServiceRequest } from '../src/lib/server/hostAuthorization';
import { notifyRuntime } from '../src/lib/server/hostRuntime';
import { actions } from '../src/routes/[[lang=locale]]/logout/+page.server';
import { DELETE, PATCH } from '../src/routes/api/admin/users/[id]/+server';

const user = {
	id: crypto.randomUUID(),
	email: 'target@example.test',
	role: 'TEACHER',
	deletedAt: null
};
function event(path: string, method: string, body = {}) {
	const url = new URL(path, 'http://web.test');
	return {
		url,
		request: new Request(url, {
			method,
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		params: { id: user.id },
		locals: {
			user: { ...user, role: 'ADMIN', sessionVersion: 3 },
			session: { expiresAt: Date.now() + 60000 }
		},
		cookies: { get: vi.fn(), delete: vi.fn() }
	} as never;
}
beforeEach(() => {
	vi.clearAllMocks();
	store.update.mockResolvedValue(user);
	store.softDelete.mockResolvedValue({ ...user, deletedAt: '2026-09-15T00:00:00Z' });
	store.findByEmail.mockResolvedValue({ ...user, sessionVersion: 4 });
	store.revokeSessions.mockResolvedValue(true);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ success: true }))
	);
});
it.each([
	PATCH,
	DELETE
])('notifies the runtime only after committed account mutation with a signed bounded request', async (handler) => {
	const response = await handler(
		event('/api/admin/users/' + user.id, 'PATCH', { role: 'TEACHER' })
	);
	expect(response.status).toBe(200);
	expect(fetch).toHaveBeenCalledTimes(1);
	const [url, init] = vi.mocked(fetch).mock.calls[0];
	expect(url).toBe('http://runtime.test/internal/host/revoke');
	expect(JSON.parse(init?.body as string)).toEqual({ userId: user.id, minSessionVersion: 4 });
	expect(
		verifyServiceRequest(
			new Headers(init?.headers).get('x-seopen-service-proof'),
			'POST',
			'/internal/host/revoke',
			init?.body as string
		)
	).toBe(true);
	expect(init?.signal).toBeInstanceOf(AbortSignal);
});
it('notifies on logout and never undoes durable revocation if notification fails', async () => {
	vi.mocked(fetch).mockRejectedValue(new Error('runtime unavailable'));
	await expect(actions.default(event('/logout', 'POST'))).rejects.toMatchObject({ status: 303 });
	expect(store.revokeSessions).toHaveBeenCalledWith(user.id, 3);
	expect(fetch).toHaveBeenCalled();
	const response = await PATCH(
		event('/api/admin/users/' + user.id, 'PATCH', { password: 'new valid password' })
	);
	expect(response.status).toBe(200);
});

it('stops waiting for an unavailable runtime at the one-second deadline', async () => {
	vi.mocked(fetch).mockImplementation(
		(_url, init) =>
			new Promise((_resolve, reject) =>
				init?.signal?.addEventListener('abort', () => reject(new Error('deadline')))
			)
	);
	const started = performance.now();
	expect(
		await notifyRuntime('/internal/host/revoke', { userId: user.id, minSessionVersion: 4 })
	).toBe(false);
	expect(performance.now() - started).toBeGreaterThanOrEqual(900);
	expect(performance.now() - started).toBeLessThan(1600);
});
