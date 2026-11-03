import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireSameOrigin, requireUser } from './guards';
import { getHostGameStore } from './hostGameStore';
import { type BaseHostGameStore, type HostGame, isGameCode, isUuid } from './hostGames';
import { readJsonBody } from './requestBody';

export async function activeGames(event: RequestEvent) {
	const games: { quiz_id: string | null; game_code: string }[] = [];
	let store: BaseHostGameStore | undefined;
	try {
		for (const game of (await event.locals.database?.getActiveGames()) ?? [])
			games.push({ quiz_id: game.quiz_id, game_code: game.game_code });
	} catch {
		/* Historical discovery remains best effort. */
	}
	try {
		store = await getHostGameStore(event);
		if (store) games.push(...(await store.listed()));
	} catch {
		/* Required host authorization never uses discovery results. */
	}
	const ownedGameCodes = new Set<string>();
	if (store && event.locals.user)
		for (const { game_code } of games) {
			try {
				if ((await store.current(game_code))?.ownerId === event.locals.user.id)
					ownedGameCodes.add(game_code);
			} catch {
				/* Ownership controls stay hidden when the authoritative lookup is unavailable. */
			}
		}
	return json(
		{
			activeGames: Object.fromEntries(
				games.filter((game) => game.quiz_id !== null).map((game) => [game.quiz_id, game.game_code])
			),
			games,
			ownedGameCodes: [...ownedGameCodes]
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
}

// Unlisting changes discovery only. Runtime completion separately ends the durable binding.
export async function setActiveGame(event: RequestEvent, listed: boolean) {
	const owner = requireUser(event);
	requireSameOrigin(event);
	const body = await readJsonBody(event.request, 4096);
	if (
		Object.keys(body).some((key) => !['gameCode', 'instanceId', 'quizId'].includes(key)) ||
		!isGameCode(body.gameCode) ||
		!isUuid(body.instanceId) ||
		(body.quizId !== undefined && !isUuid(body.quizId))
	)
		error(400, 'Current game instance required');
	let store: BaseHostGameStore | undefined;
	try {
		store = await getHostGameStore(event);
	} catch {
		error(503, 'Game ownership service unavailable');
	}
	if (!store) error(503, 'Game ownership service unavailable');
	let game: HostGame | null;
	try {
		game = await store.current(body.gameCode);
	} catch {
		error(503, 'Game ownership service unavailable');
	}
	if (
		!game ||
		game.instanceId !== body.instanceId ||
		game.ownerId !== owner.id ||
		(body.quizId !== undefined && body.quizId !== game.originUniqueId) ||
		(listed && !game.originUniqueId)
	)
		error(404, 'Game not found');
	let updated: boolean;
	try {
		updated = await store.setListed(owner.id, owner.sessionVersion, game.instanceId, listed);
	} catch {
		error(503, 'Game ownership service unavailable');
	}
	if (!updated) error(404, 'Game not found');
	return json({ success: true }, { headers: { 'cache-control': 'no-store' } });
}
