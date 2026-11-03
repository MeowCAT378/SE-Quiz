import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, expect, it, vi } from 'vitest';
import { getDrive } from '../src/routes/api/gdrive/driveUtil';
import { managedDriveRoute } from '../src/routes/api/gdrive/managedRoutes';

const env = vi.hoisted(() => ({
	ADMIN_SESSION_SECRET: 'disposable-drive-test-key',
	AUTH_GOOGLE_ID: 'fixture',
	AUTH_GOOGLE_SECRET: 'fixture',
	AUTH_GOOGLE_REDIRECT_URI: 'https://example.test/api/gdrive/callback'
}));
vi.mock('$env/dynamic/private', () => ({ env }));

import { getPrivateResourceStore } from '../src/lib/server/privateResourceStore';
import { GET as callback } from '../src/routes/api/gdrive/callback/+server';
import { GET as read } from '../src/routes/api/gdrive/fuiz/[uuid]/+server';
import { GET as login } from '../src/routes/api/gdrive/login/+server';
import { GET as status } from '../src/routes/api/gdrive/status/+server';

vi.mock('../src/lib/server/privateResourceStore', () => ({ getPrivateResourceStore: vi.fn() }));
// Match the browser/runtime typed-array base64 API on the installed Node test runner.
Object.defineProperty(Uint8Array.prototype, 'toBase64', {
	configurable: true,
	value() {
		return Buffer.from(this).toString('base64');
	}
});
const a = '00000000-0000-4000-a000-000000000001';
const b = '00000000-0000-4000-a000-000000000002';
let jar: Map<string, string>;
function event(path: string, user: string | null = a, version = 1): never {
	const url = new URL(`https://example.test${path}`);
	return {
		url,
		request: new Request(url, { headers: { 'sec-fetch-site': 'same-origin' } }),
		cookies: {
			get: (key: string) => jar.get(key),
			set: (key: string, value: string) => jar.set(key, value),
			delete: (key: string) => jar.delete(key)
		},
		locals: {
			user: user ? { id: user, role: 'TEACHER', sessionVersion: version } : null,
			session: user ? { issuedAt: 10, expiresAt: 9999999999999 } : null
		},
		params: { uuid: a }
	} as never;
}
beforeEach(() => {
	jar = new Map();
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			Response.json({ access_token: 'fixture-token', refresh_token: 'fixture-refresh' })
		)
	);
});
async function connect() {
	const response = await login(event('/api/gdrive/login?return=//evil.test'));
	const state = new URL(response.headers.get('location')!).searchParams.get('state');
	return callback(event(`/api/gdrive/callback?code=fixture&state=${encodeURIComponent(state!)}`));
}
it('independently rejects anonymous Drive status and record reads', async () => {
	jar.set('google', JSON.stringify({ access_token: 'legacy' }));
	await expect(status(event('/api/gdrive/status', null))).rejects.toMatchObject({ status: 401 });
	await expect(read(event(`/api/gdrive/fuiz/${a}`, null))).rejects.toMatchObject({ status: 401 });
});
it('does not recognize an old unbound Google credential as current authentication', async () => {
	jar.set('google', JSON.stringify({ access_token: 'legacy' }));
	expect(await (await status(event('/api/gdrive/status'))).json()).toMatchObject({
		authenticated: false
	});
});
it('binds tokens to current account/version and sanitizes the callback return path', async () => {
	const response = await connect();
	expect(response.headers.get('location')).toBe('/');
	expect(await (await status(event('/api/gdrive/status'))).json()).toMatchObject({
		authenticated: true
	});
	expect(await (await status(event('/api/gdrive/status', b))).json()).toMatchObject({
		authenticated: false
	});
	expect(jar.has('google')).toBe(false);
	await connect();
	expect(await (await status(event('/api/gdrive/status', a, 2))).json()).toMatchObject({
		authenticated: false
	});
});
it('consumes state on failure and rejects a callback after account switching', async () => {
	const response = await login(event('/api/gdrive/login'));
	const state = new URL(response.headers.get('location')!).searchParams.get('state');
	await expect(
		callback(event(`/api/gdrive/callback?code=fixture&state=${encodeURIComponent(state!)}`, b))
	).rejects.toMatchObject({ status: 403 });
	expect(jar.has('oauth_state')).toBe(false);
	expect(jar.has('google')).toBe(false);
});
it('requires authoritative resource ownership before looking up a Drive file', async () => {
	await connect();
	vi.mocked(getPrivateResourceStore).mockResolvedValue({ get: async () => null } as never);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			Response.json(
				url.includes('alt=media') ? { title: 'Foreign' } : { files: [{ id: 'foreign-file' }] }
			)
		)
	);
	await expect(read(event(`/api/gdrive/fuiz/${a}`))).rejects.toMatchObject({ status: 404 });
});
it('scopes and escapes every lookup by account, app-data space and resource MIME', async () => {
	await connect();
	const fetcher = vi.fn(async (_url: string) => Response.json({ files: [] }));
	vi.stubGlobal('fetch', fetcher);
	await getDrive(event('/api/gdrive/fuiz')).list(['id'], {
		name: "name' or trashed=true",
		mimeType: 'application/json'
	});
	const url = new URL(String(fetcher.mock.calls[0][0]));
	expect(url.searchParams.get('spaces')).toBe('appDataFolder');
	expect(url.searchParams.get('q')).toContain(`value='${a}'`);
	expect(url.searchParams.get('q')).toContain("name = 'name\\' or trashed=true'");
	expect(url.searchParams.get('q')).toContain("mimeType = 'application/json'");
});
it('rejects forged owner fields instead of copying them to managed Drive', async () => {
	await connect();
	const record = { uniqueId: a, versionId: 0, lastEdited: 1, config: { title: '', slides: [] } };
	vi.mocked(getPrivateResourceStore).mockResolvedValue({ get: async () => ({ record }) } as never);
	const fetcher = vi.fn(async (_url: string) => Response.json({ files: [] }));
	vi.stubGlobal('fetch', fetcher);
	const request = event(`/api/gdrive/fuiz/${a}`) as RequestEvent;
	request.request = new Request(request.url, {
		method: 'POST',
		headers: { origin: request.url.origin },
		body: JSON.stringify({ ...record, ownerId: b })
	});
	await expect(managedDriveRoute(request, 'creation', a)).rejects.toMatchObject({ status: 400 });
	expect(fetcher.mock.calls.every((call) => !String(call[0]).includes('/upload/'))).toBe(true);
});
it('preserves account/version binding after refreshing the Google credential', async () => {
	await connect();
	let count = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url.includes('oauth2')
				? Response.json({ access_token: 'refreshed-fixture' })
				: ++count === 1
					? new Response(null, { status: 401 })
					: Response.json({ files: [] })
		)
	);
	await getDrive(event('/api/gdrive/fuiz')).list(['id'], { mimeType: 'application/json' });
	expect(await (await status(event('/api/gdrive/status'))).json()).toMatchObject({
		authenticated: true
	});
	expect(await (await status(event('/api/gdrive/status', b))).json()).toMatchObject({
		authenticated: false
	});
});
it('requires explicit ADMIN legacy connection and prevents legacy mutation', async () => {
	await connect();
	await expect(
		Promise.resolve().then(() => getDrive(event('/api/gdrive/legacy'), true))
	).rejects.toMatchObject({ status: 403 });
	const admin = event('/api/gdrive/legacy') as RequestEvent;
	admin.locals.user!.role = 'ADMIN';
	expect(() => getDrive(admin, true)).toThrow();
	const start = event('/api/gdrive/login?legacy=1') as RequestEvent;
	start.locals.user!.role = 'ADMIN';
	const response = await login(start as never);
	const state = new URL(response.headers.get('location')!).searchParams.get('state');
	const complete = event(`/api/gdrive/callback?code=fixture&state=${state}`) as RequestEvent;
	complete.locals.user!.role = 'ADMIN';
	await callback(complete as never);
	const legacy = getDrive(admin, true);
	await expect(legacy.deleteFile({ id: 'fixture' })).rejects.toMatchObject({ status: 403 });
	const fetcher = vi.fn(async (_url: string) => Response.json({ files: [] }));
	vi.stubGlobal('fetch', fetcher);
	await legacy.list(['id'], { mimeType: 'application/json' });
	expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('q')).toContain(
		"not appProperties has { key='seopenAccount' }"
	);
});
