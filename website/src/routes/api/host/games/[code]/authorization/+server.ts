import { error, json, type RequestHandler } from '@sveltejs/kit';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { signGrant } from '$lib/server/hostAuthorization';
import { getHostGameStore } from '$lib/server/hostGameStore';
import { type HostGame, isGameCode } from '$lib/server/hostGames';

export const POST: RequestHandler = async (event) => {
	const owner = requireUser(event);
	requireSameOrigin(event);
	if (!isGameCode(event.params.code)) error(404, 'Game not found');
	let game: HostGame | null;
	try {
		const store = await getHostGameStore(event);
		if (!store) throw new Error('Unavailable');
		game = await store.current(event.params.code);
	} catch {
		error(503, 'Game ownership service unavailable');
	}
	if (!game || game.ownerId !== owner.id) error(404, 'Game not found');
	const now = Date.now();
	let grant: string;
	try {
		grant = signGrant({
			purpose: 'host-game',
			userId: owner.id,
			sessionVersion: owner.sessionVersion,
			issuedAt: now,
			expiresAt: Math.min(now + 300_000, event.locals.session?.expiresAt ?? 0),
			instanceId: game.instanceId,
			gameCode: game.code,
			watcherId: game.hostWatcherId
		});
	} catch {
		error(503, 'Host authorization unavailable');
	}
	return json(
		{
			grant,
			instanceId: game.instanceId,
			watcherId: game.hostWatcherId,
			origin:
				game.originUniqueId === null
					? null
					: { uniqueId: game.originUniqueId, versionId: game.originVersionId }
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
