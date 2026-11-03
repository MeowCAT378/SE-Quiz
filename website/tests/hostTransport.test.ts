import { expect, it, vi } from 'vitest';
import { resolve } from '$app/paths';
import { hideHostedGame, requestHostAuthorization } from '../src/lib/hostTransport';

it('a denied issuance never returns browser watcher credentials', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('', { status: 403 }))
	);
	await expect(requestHostAuthorization('12345')).rejects.toThrow();
	vi.unstubAllGlobals();
});
it('hiding a room sends its immutable instance to the owner endpoint', async () => {
	const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
	vi.stubGlobal('fetch', fetcher);
	await hideHostedGame('12345', 'instance');
	expect(fetcher).toHaveBeenCalledWith(
		resolve('/api/games/active'),
		expect.objectContaining({
			method: 'DELETE',
			body: JSON.stringify({ gameCode: '12345', instanceId: 'instance' })
		})
	);
	vi.unstubAllGlobals();
});
