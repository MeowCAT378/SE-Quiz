import { afterEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('$env/dynamic/private', () => ({ env }));

import {
	exchangeCodeForTokens,
	generateAuthUrl,
	refreshToken
} from '../src/routes/api/gdrive/driveUtil';

afterEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.unstubAllGlobals();
});

it('rejects missing OAuth settings before contacting Google', async () => {
	const fetch = vi.fn().mockResolvedValue(new Response('{}'));
	vi.stubGlobal('fetch', fetch);
	expect(() => generateAuthUrl('state')).toThrow();
	await expect(exchangeCodeForTokens('code')).rejects.toThrow();
	expect(await refreshToken({ access_token: 'test', refresh_token: 'test' })).toBeUndefined();
	expect(fetch).not.toHaveBeenCalled();
});

it('uses configured OAuth settings in authorization and token exchange', async () => {
	Object.assign(env, {
		AUTH_GOOGLE_ID: 'test-id',
		AUTH_GOOGLE_SECRET: 'test-secret',
		AUTH_GOOGLE_REDIRECT_URI: 'https://example.test/callback'
	});
	const fetch = vi.fn().mockResolvedValue(new Response('{"access_token":"test-token"}'));
	vi.stubGlobal('fetch', fetch);
	expect(new URL(generateAuthUrl('state')).searchParams.get('client_id')).toBe('test-id');
	expect(await exchangeCodeForTokens('code')).toEqual({ access_token: 'test-token' });
	expect(fetch.mock.calls[0][1].body.get('client_secret')).toBe('test-secret');
});
