import { publicAccount } from '$lib/server/accounts';
import { fixPublish } from '$lib/serverOnlyUtils';
import type { PageServerLoad } from './$types';

async function getStatistics(platform: Readonly<App.Platform> | undefined): Promise<{
	gamesPlayed: number | undefined;
	playersJoined: number | undefined;
}> {
	try {
		const allCounts = (await platform?.env?.COUNTER?.getAllCounts()) ?? {};
		return {
			gamesPlayed: allCounts.game_count,
			playersJoined: allCounts.player_count
		};
	} catch {
		return {
			gamesPlayed: undefined,
			playersJoined: undefined
		};
	}
}

export const load = (async ({ platform, locals }) => {
	let rawQuizzes: any[] = [];
	try {
		if (locals.database) {
			rawQuizzes = await locals.database.getRecentlyPublished(50);
		} else {
			console.warn('[Home Page Load] locals.database is not configured');
		}
	} catch (err) {
		console.error('[Home Page Load] Error calling getRecentlyPublished:', err);
		rawQuizzes = [];
	}

	const stats = await getStatistics(platform);

	let quizzes: any[] = [];
	try {
		quizzes = (rawQuizzes ?? []).map(fixPublish);
	} catch (err) {
		console.error('[Home Page Load] Error mapping fixPublish:', err);
		quizzes = rawQuizzes ?? [];
	}

	console.log(`[Home Page Load] Successfully loaded ${quizzes.length} quizzes for home page`);

	const activeGames: Record<string, string> = {};
	try {
		if (locals.database) {
			const games = await locals.database.getActiveGames();
			for (const g of games) {
				activeGames[g.quiz_id] = g.game_code;
			}
		}
	} catch (err) {
		console.error('[Home Page Load] Error calling getActiveGames:', err);
	}

	return {
		gamesPlayed: stats.gamesPlayed,
		playersJoined: stats.playersJoined,
		quizzes,
		user: locals.user ? publicAccount(locals.user) : null,
		isAdmin: !!locals.isAdmin,
		activeGames
	};
}) satisfies PageServerLoad;
