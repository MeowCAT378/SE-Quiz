import type { D1Database } from '@cloudflare/workers-types';
import {
	BaseHostGameStore,
	type GameOrigin,
	type HostGameRow,
	hostGameFromRow,
	type NewHostGame,
	originMatches,
	validateHostGame
} from './hostGames';

export class D1HostGameStore extends BaseHostGameStore {
	async complete(instanceId: string, code: string, ownerId: string, watcherId: string) {
		const result = await this.db
			.prepare(
				'UPDATE host_games SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP), listed = 0 WHERE instance_id = ? AND code = ? AND owner_id = ? AND host_watcher_id = ?'
			)
			.bind(instanceId, code, ownerId, watcherId)
			.run();
		return result.meta.changes === 1;
	}
	constructor(private db: D1Database) {
		super();
	}
	async record(game: NewHostGame, sessionVersion: number) {
		validateHostGame(game, sessionVersion);
		// The insert trigger checks current identity and origin; a failed insert rolls back both statements.
		await this.db.batch([
			this.db
				.prepare(
					'UPDATE host_games SET ended_at = CURRENT_TIMESTAMP, listed = 0 WHERE code = ? AND ended_at IS NULL'
				)
				.bind(game.code),
			this.db
				.prepare(
					'INSERT INTO host_games(instance_id,code,owner_id,host_watcher_id,origin_unique_id,origin_version_id,session_version,listed) VALUES (?,?,?,?,?,?,?,?)'
				)
				.bind(
					game.instanceId,
					game.code,
					game.ownerId,
					game.hostWatcherId,
					game.originUniqueId,
					game.originVersionId,
					sessionVersion,
					game.listed !== false ? 1 : 0
				)
		]);
	}
	async current(code: string) {
		const row = await this.db
			.prepare('SELECT * FROM host_games WHERE code = ? AND ended_at IS NULL')
			.bind(code)
			.first<HostGameRow>();
		return row ? hostGameFromRow(row) : null;
	}
	async ownsOrigin(ownerId: string, origin: GameOrigin) {
		const row = await this.db
			.prepare(
				"SELECT body FROM host_resources WHERE owner_id = ? AND kind = 'creation' AND unique_id = ? AND version_id = ?"
			)
			.bind(ownerId, origin.uniqueId, origin.versionId)
			.first<{ body: string }>();
		return originMatches(row?.body, origin);
	}
	async setListed(ownerId: string, sessionVersion: number, instanceId: string, listed: boolean) {
		const result = await this.db
			.prepare(
				"UPDATE host_games SET listed = ? WHERE owner_id = ? AND instance_id = ? AND ended_at IS NULL AND EXISTS (SELECT 1 FROM admins WHERE id = ? AND session_version = ? AND deleted_at IS NULL AND role IN ('ADMIN','TEACHER'))"
			)
			.bind(listed ? 1 : 0, ownerId, instanceId, ownerId, sessionVersion)
			.run();
		return result.meta.changes === 1;
	}
	async listed() {
		return (
			await this.db
				.prepare(
					'SELECT origin_unique_id AS quiz_id,code AS game_code FROM host_games WHERE listed = 1 AND ended_at IS NULL ORDER BY created_at'
				)
				.all<{ quiz_id: string | null; game_code: string }>()
		).results;
	}
}
