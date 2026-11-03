import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('$env/dynamic/private', () => ({ env }));

import {
	createSessionToken,
	safeReturnPath,
	setAdminSession,
	verifySessionToken
} from '../src/lib/server/auth';

beforeEach(() => {
	Object.assign(env, { ADMIN_SESSION_SECRET: 'test-session-key', DB_PROVIDER: 'd1' });
});
afterEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.useRealTimers();
});

describe('administrator boundaries', () => {
	it('signs stable user identities and rejects tampered, expired, and future sessions', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
		const token = createSessionToken({
			id: '11111111-1111-4111-8111-111111111111',
			sessionVersion: 0
		});
		expect(verifySessionToken(token).valid).toBe(true);
		expect(verifySessionToken(`${token.slice(0, -1)}z`).valid).toBe(false);
		vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
		expect(verifySessionToken(token).valid).toBe(false);
		vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
		expect(verifySessionToken(token).valid).toBe(false);
	});
	it('requires a signing secret', () => {
		delete env.ADMIN_SESSION_SECRET;
		expect(() =>
			createSessionToken({ id: '11111111-1111-4111-8111-111111111111', sessionVersion: 0 })
		).toThrow();
	});
	it.each([
		['/th/create?x=1', '/th/create?x=1'],
		['https://example.test', '/'],
		['//example.test', '/'],
		['/x/..//example.test', '/'],
		['/x/%2e%2e//example.test', '/'],
		['/\\example.test', '/'],
		['/\n/example.test', '/'],
		['', '/']
	])('keeps return path %j within this origin', (input, expected) => {
		expect(safeReturnPath(input)).toBe(expected);
	});
	it('sets an HTTP-only seven-day cookie suitable for the request protocol', () => {
		const set = vi.fn();
		const cookies = { set } as unknown as Parameters<typeof setAdminSession>[0];
		setAdminSession(
			cookies,
			{ id: '11111111-1111-4111-8111-111111111111', sessionVersion: 0 },
			new URL('http://localhost:9300')
		);
		expect(set.mock.calls[0][2]).toMatchObject({
			httpOnly: true,
			sameSite: 'lax',
			secure: false,
			maxAge: 604800,
			path: '/'
		});
		setAdminSession(
			cookies,
			{ id: '11111111-1111-4111-8111-111111111111', sessionVersion: 0 },
			new URL('https://example.test')
		);
		expect(set.mock.calls[1][2].secure).toBe(true);
	});
});
