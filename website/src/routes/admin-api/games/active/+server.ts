import type { RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/guards';
import { activeGames, setActiveGame } from '$lib/server/hostActiveGames';

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	return activeGames(event);
};
export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	return setActiveGame(event, true);
};
export const DELETE: RequestHandler = async (event) => {
	requireAdmin(event);
	return setActiveGame(event, false);
};
