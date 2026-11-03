import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ complete: vi.fn(async () => true) }));
vi.mock('$env/dynamic/private', () => ({ env: { ADMIN_SESSION_SECRET: 'test-only-service-key' } }));
vi.mock('$lib/server/hostGameStore', () => ({ getHostGameStore: async () => mocks }));

import { signServiceRequest } from '../src/lib/server/hostAuthorization';
import { D1HostGameStore } from '../src/lib/server/hostGamesD1';
import { POST } from '../src/routes/api/host/completed/+server';

const binding = {
	instanceId: '10000000-0000-4000-8000-000000000001',
	ownerId: '10000000-0000-4000-8000-000000000002',
	watcherId: '10000000-0000-4000-8000-000000000003',
	gameCode: '12345'
};
function event(signed = true, input: object = binding) {
	const body = JSON.stringify(input);
	return {
		url: new URL('http://localhost/api/host/completed'),
		request: new Request('http://localhost/api/host/completed', {
			method: 'POST',
			body,
			headers: signed
				? { 'x-seopen-service-proof': signServiceRequest('POST', '/api/host/completed', body) }
				: {}
		})
	} as Parameters<typeof POST>[0];
}
describe('runtime completion', () => {
	it('rejects unauthenticated completion', async () => {
		await expect(POST(event(false))).rejects.toMatchObject({ status: 401 });
	});
	it('requires a complete exact binding', async () => {
		await expect(POST(event(true, { ...binding, watcherId: 'invalid' }))).rejects.toMatchObject({
			status: 400
		});
	});
	it('passes all four bound identities and permits idempotent retries', async () => {
		for (let i = 0; i < 2; i++) expect((await POST(event())).status).toBe(200);
		expect(mocks.complete).toHaveBeenLastCalledWith(
			binding.instanceId,
			binding.gameCode,
			binding.ownerId,
			binding.watcherId
		);
	});
	it('does not claim completion for a missing binding', async () => {
		mocks.complete.mockResolvedValueOnce(false);
		await expect(POST(event())).rejects.toMatchObject({ status: 404 });
	});
	it('D1 completion binds instance, code, owner and watcher in one idempotent update', async () => {
		const run = vi.fn(async () => ({ meta: { changes: 1 } }));
		const bind = vi.fn((..._args: unknown[]) => ({ run }));
		const prepare = vi.fn((_sql: string) => ({ bind }));
		const store = new D1HostGameStore({ prepare } as never);
		expect(
			await store.complete(binding.instanceId, binding.gameCode, binding.ownerId, binding.watcherId)
		).toBe(true);
		expect(prepare.mock.calls[0][0]).toContain('COALESCE(ended_at, CURRENT_TIMESTAMP)');
		expect(bind).toHaveBeenCalledWith(
			binding.instanceId,
			binding.gameCode,
			binding.ownerId,
			binding.watcherId
		);
	});
});
