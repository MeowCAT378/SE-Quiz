import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { ADMIN_SESSION_SECRET: 'test-session-key' } }));

import { normalizeEmail, publicAccount, validateAccountInput } from '../src/lib/server/accounts';
import { createSessionToken, verifySessionToken } from '../src/lib/server/auth';

describe('managed identity boundaries', () => {
	it('rejects a correctly signed legacy email cookie', () => {
		const payload = `${Buffer.from('operator@example.test').toString('base64url')}.${Date.now()}`;
		const signature = createHmac('sha256', 'test-session-key').update(payload).digest('hex');
		expect(verifySessionToken(`${payload}.${signature}`).valid).toBe(false);
	});
	it('round trips immutable identity, version and expiration', () => {
		const identity = { id: crypto.randomUUID(), sessionVersion: 3 };
		expect(verifySessionToken(createSessionToken(identity))).toMatchObject({
			valid: true,
			userId: identity.id,
			sessionVersion: 3
		});
	});
	it('validates new accounts and never returns security fields', () => {
		expect(normalizeEmail(' TEACHER@EXAMPLE.TEST ')).toBe('teacher@example.test');
		expect(
			validateAccountInput({ email: 'teacher@example.test', password: 'long password ☃' }).role
		).toBe('TEACHER');
		expect(() => validateAccountInput({ email: 'bad', password: 'short' })).toThrow();
		expect(() => validateAccountInput({ email: 'a@b.test', password: '😀'.repeat(300) })).toThrow();
		const account = {
			id: crypto.randomUUID(),
			email: 'a@b.test',
			role: 'ADMIN' as const,
			createdAt: 'now',
			deletedAt: null,
			sessionVersion: 4,
			password_hash: 'never disclose'
		};
		expect(Object.keys(publicAccount(account)).sort()).toEqual([
			'createdAt',
			'deletedAt',
			'email',
			'id',
			'role'
		]);
	});
});
