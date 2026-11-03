import type { SQL } from 'bun';
import {
	BaseHostGameStore,
	type GameOrigin,
	type HostGameRow,
	hostGameFromRow,
	type NewHostGame,
	originMatches,
	validateHostGame
} from './hostGames';

export class PostgresHostGameStore extends BaseHostGameStore {
	async complete(instanceId: string, code: string, ownerId: string, watcherId: string) {
		const rows = await this
			.sql`UPDATE host_games SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP), listed = 0 WHERE instance_id = ${instanceId} AND code = ${code} AND owner_id = ${ownerId} AND host_watcher_id = ${watcherId} RETURNING instance_id`;
		return rows.length === 1;
	}
	constructor(private sql: SQL) {
		super();
	}
	async record(game: NewHostGame, sessionVersion: number) {
		validateHostGame(game, sessionVersion);
		await this.sql.begin(async (tx) => {
			const [actor] =
				await tx`SELECT id FROM admins WHERE id = ${game.ownerId} AND session_version = ${sessionVersion} AND deleted_at IS NULL AND role IN ('ADMIN','TEACHER') FOR SHARE`;
			if (!actor) throw new Error('Current account required');
			if (game.originUniqueId !== null) {
				const [row] =
					await tx`SELECT body FROM host_resources WHERE owner_id = ${game.ownerId} AND kind = 'creation' AND unique_id = ${game.originUniqueId} AND version_id = ${game.originVersionId} FOR SHARE`;
				if (
					!originMatches(row?.body, {
						uniqueId: game.originUniqueId,
						versionId: game.originVersionId ?? -1
					})
				)
					throw new Error('Owned creation required');
			}
			await tx`UPDATE host_games SET ended_at = CURRENT_TIMESTAMP, listed = 0 WHERE code = ${game.code} AND ended_at IS NULL`;
			await tx`INSERT INTO host_games(instance_id,code,owner_id,host_watcher_id,origin_unique_id,origin_version_id,session_version,listed) VALUES (${game.instanceId},${game.code},${game.ownerId},${game.hostWatcherId},${game.originUniqueId},${game.originVersionId},${sessionVersion},${game.listed !== false ? 1 : 0})`;
		});
	}
	async current(code: string) {
		const [row] = await this.sql<
			HostGameRow[]
		>`SELECT * FROM host_games WHERE code = ${code} AND ended_at IS NULL`;
		return row ? hostGameFromRow(row) : null;
	}
	async ownsOrigin(ownerId: string, origin: GameOrigin) {
		const [row] = await this.sql<
			{ body: string }[]
		>`SELECT body FROM host_resources WHERE owner_id = ${ownerId} AND kind = 'creation' AND unique_id = ${origin.uniqueId} AND version_id = ${origin.versionId}`;
		return originMatches(row?.body, origin);
	}
	async setListed(ownerId: string, sessionVersion: number, instanceId: string, listed: boolean) {
		return this.sql.begin(async (tx) => {
			const [actor] =
				await tx`SELECT id FROM admins WHERE id = ${ownerId} AND session_version = ${sessionVersion} AND deleted_at IS NULL AND role IN ('ADMIN','TEACHER') FOR SHARE`;
			if (!actor) return false;
			const rows =
				await tx`UPDATE host_games SET listed = ${listed ? 1 : 0} WHERE owner_id = ${ownerId} AND instance_id = ${instanceId} AND ended_at IS NULL RETURNING instance_id`;
			return rows.length === 1;
		});
	}
	async listed() {
		return await this.sql<
			{ quiz_id: string | null; game_code: string }[]
		>`SELECT origin_unique_id AS quiz_id,code AS game_code FROM host_games WHERE listed = 1 AND ended_at IS NULL ORDER BY created_at`;
	}
}
