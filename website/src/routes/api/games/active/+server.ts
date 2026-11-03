import type { RequestHandler } from '@sveltejs/kit';
import { activeGames, setActiveGame } from '$lib/server/hostActiveGames';

export const GET: RequestHandler = activeGames;
export const POST: RequestHandler = (event) => setActiveGame(event, true);
export const DELETE: RequestHandler = (event) => setActiveGame(event, false);
