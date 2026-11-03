export type GameOrigin = { uniqueId: string; versionId: number };
// Codes are reusable discovery handles; instanceId binds grants, completion and report history.
export type HostGame = {
	instanceId: string;
	code: string;
	ownerId: string;
	hostWatcherId: string;
	originUniqueId: string | null;
	originVersionId: number | null;
	createdAt: string;
	endedAt: string | null;
};
export type NewHostGame = Omit<HostGame, 'createdAt' | 'endedAt'> & { listed?: boolean };
export const isUuid = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isGameCode = (value: unknown): value is string =>
	typeof value === 'string' && /^[1-7][0-7]{4}$/.test(value);
export function validateHostGame(game: NewHostGame, sessionVersion: number) {
	if (
		!isGameCode(game.code) ||
		!isUuid(game.instanceId) ||
		!isUuid(game.ownerId) ||
		!isUuid(game.hostWatcherId) ||
		!Number.isSafeInteger(sessionVersion) ||
		sessionVersion < 0 ||
		(game.originUniqueId === null
			? game.originVersionId !== null
			: !isUuid(game.originUniqueId) ||
				typeof game.originVersionId !== 'number' ||
				!Number.isSafeInteger(game.originVersionId) ||
				game.originVersionId < 0)
	)
		throw new Error('Invalid game binding');
}
export type HostGameRow = {
	instance_id: string;
	code: string;
	owner_id: string;
	host_watcher_id: string;
	origin_unique_id: string | null;
	origin_version_id: number | null;
	created_at: string | Date;
	ended_at: string | Date | null;
};
export function hostGameFromRow(row: HostGameRow): HostGame {
	return {
		instanceId: row.instance_id,
		code: row.code,
		ownerId: row.owner_id,
		hostWatcherId: row.host_watcher_id,
		originUniqueId: row.origin_unique_id,
		originVersionId: row.origin_version_id === null ? null : Number(row.origin_version_id),
		createdAt: new Date(row.created_at).toISOString(),
		endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null
	};
}
export function originMatches(body: string | undefined, origin: GameOrigin): boolean {
	if (!body) return false;
	try {
		const resource = JSON.parse(body);
		return resource.uniqueId === origin.uniqueId && resource.versionId === origin.versionId;
	} catch {
		return false;
	}
}
export abstract class BaseHostGameStore {
	abstract complete(
		instanceId: string,
		code: string,
		ownerId: string,
		watcherId: string
	): Promise<boolean>;
	abstract record(game: NewHostGame, sessionVersion: number): Promise<void>;
	abstract current(code: string): Promise<HostGame | null>;
	abstract ownsOrigin(ownerId: string, origin: GameOrigin): Promise<boolean>;
	abstract setListed(
		ownerId: string,
		sessionVersion: number,
		instanceId: string,
		listed: boolean
	): Promise<boolean>;
	abstract listed(): Promise<{ quiz_id: string | null; game_code: string }[]>;
}
