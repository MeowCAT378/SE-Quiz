import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ ADMIN_SESSION_SECRET: 'test-only-host-signing-key' }));
vi.mock('$env/dynamic/private', () => ({ env }));

import * as auth from '../src/lib/server/hostAuthorization';

describe('host transport authorization', () => {
	it('binds host grants to their purpose, owner, session version and game instance', () => {
		const now = 1_800_000_000_000;
		const token = auth.signGrant({
			purpose: 'host-game',
			userId: 'owner',
			sessionVersion: 3,
			issuedAt: now,
			expiresAt: now + 300_000,
			instanceId: 'instance',
			gameCode: 'ABCD',
			watcherId: 'host-watcher'
		});
		expect(auth.verifyGrant(token, 'host-game', now)).toMatchObject({
			userId: 'owner',
			sessionVersion: 3,
			instanceId: 'instance'
		});
		expect(auth.verifyGrant(token, 'create-game', now)).toBeNull();
		expect(auth.verifyGrant(token + 'x', 'host-game', now)).toBeNull();
		expect(auth.verifyGrant(token, 'host-game', now + 300_000)).toBeNull();
		expect(auth.verifyGrant(token, 'host-game', now - 60_000)).toBeNull();
	});
	it('rejects unbounded grant lifetimes and missing host scope', () => {
		const base = {
			purpose: 'create-game' as const,
			userId: 'owner',
			sessionVersion: 0,
			issuedAt: 1_800_000_000_000
		};
		expect(() => auth.signGrant({ ...base, expiresAt: base.issuedAt + 60_001 })).toThrow();
		expect(() =>
			auth.signGrant({ ...base, purpose: 'host-game', expiresAt: base.issuedAt + 60_000 })
		).toThrow();
	});
	it('authenticates exact service method, path, body and a thirty-second window', () => {
		const now = 1_800_000_000_000;
		const body = '{"grant":"test-only"}';
		const proof = auth.signServiceRequest('POST', '/api/host/authorize', body, now);
		expect(auth.verifyServiceRequest(proof, 'POST', '/api/host/authorize', body, now)).toBe(true);
		expect(auth.verifyServiceRequest(proof, 'GET', '/api/host/authorize', body, now)).toBe(false);
		expect(auth.verifyServiceRequest(proof, 'POST', '/api/admin/users', body, now)).toBe(false);
		expect(auth.verifyServiceRequest(proof, 'POST', '/api/host/authorize', '{}', now)).toBe(false);
		expect(
			auth.verifyServiceRequest(proof, 'POST', '/api/host/authorize', body, now + 30_001)
		).toBe(false);
	});
});
