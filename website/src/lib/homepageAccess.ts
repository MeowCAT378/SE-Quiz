export function canManageActiveGame(
	user: { id: string } | null,
	ownedGameCodes: readonly string[],
	gameCode: string | undefined
): boolean {
	return !!user && !!gameCode && ownedGameCodes.includes(gameCode);
}

export function canCreate(user: { id: string } | null): boolean {
	return !!user;
}

export type LiveRoom = { quiz_id: string | null; game_code: string };

export function liveRooms(
	games: readonly LiveRoom[],
	activeGames: Record<string, string>,
	quizzes: readonly { id: string }[]
): LiveRoom[] {
	const represented = new Set(quizzes.map((quiz) => activeGames[quiz.id]));
	return games.filter(({ game_code }) => {
		if (represented.has(game_code)) return false;
		represented.add(game_code);
		return true;
	});
}
