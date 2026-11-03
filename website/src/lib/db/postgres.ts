import type { SQL } from 'bun';
import type { PublishedFuizDB } from '$lib/types';
import {
	type ActiveGame,
	BaseDatabase,
	type FuizExistingStats,
	type FuizInsertData,
	type SearchFilters
} from './base';
import { buildSearchQuery } from './search';

function normalize<T extends object>(row: T): T {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [
			key,
			value instanceof Date ? value.toISOString() : value
		])
	) as T;
}

export class PostgresDatabase extends BaseDatabase {
	constructor(private sql: SQL) {
		super();
	}

	async getPublishedIds(): Promise<string[]> {
		const rows = await this.sql<{ id: string }[]>`SELECT id FROM fuizzes`;
		return rows.map((row) => row.id);
	}

	async tableExists(): Promise<boolean> {
		const [row] = await this.sql`SELECT to_regclass('public.fuizzes') IS NOT NULL AS present`;
		return row.present;
	}

	async getRecentlyPublished(limit: number): Promise<PublishedFuizDB[]> {
		return (
			await this.sql<
				PublishedFuizDB[]
			>`SELECT * FROM fuizzes ORDER BY published_at DESC LIMIT ${limit}`
		).map(normalize);
	}

	async getById(id: string): Promise<PublishedFuizDB | null> {
		const [row] = await this.sql<PublishedFuizDB[]>`SELECT * FROM fuizzes WHERE id = ${id}`;
		return row ? normalize(row) : null;
	}

	async search(term: string, filters: SearchFilters, limit: number): Promise<PublishedFuizDB[]> {
		const { sql, params } = buildSearchQuery(term, filters, limit, 'postgres');
		return (await this.sql.unsafe<PublishedFuizDB[]>(sql, params)).map(normalize);
	}

	async getDistinctLanguages(): Promise<string[]> {
		const rows = await this.sql<
			{ language: string }[]
		>`SELECT DISTINCT language FROM fuizzes WHERE language <> '' ORDER BY language`;
		return rows.map((row) => row.language);
	}

	async getExistingStats(id: string): Promise<FuizExistingStats | null> {
		const [row] = await this.sql<
			FuizExistingStats[]
		>`SELECT id, played_count, view_count, published_at, git_commit_sha FROM fuizzes WHERE id = ${id}`;
		return row ? normalize(row) : null;
	}

	async insertFuiz(data: FuizInsertData): Promise<void> {
		const thumbnail = data.thumbnail ? Buffer.from(new Uint8Array(data.thumbnail)) : null;
		await this.sql`INSERT INTO fuizzes (
			id, storage_id, title, author, language, subjects, grades, keywords, slides_count,
			thumbnail, thumbnail_alt, git_commit_sha, played_count, view_count, published_at, updated_at
		) VALUES (
			${data.id}, ${data.storage_id}, ${data.title}, ${data.author}, ${data.language}, ${data.subjects},
			${data.grades}, ${data.keywords}, ${data.slides_count}, ${thumbnail}, ${data.thumbnail_alt},
			${data.git_commit_sha}, ${data.played_count}, ${data.view_count}, ${data.published_at}, ${data.updated_at}
		) ON CONFLICT (id) DO UPDATE SET
			storage_id = EXCLUDED.storage_id, title = EXCLUDED.title, author = EXCLUDED.author,
			language = EXCLUDED.language, subjects = EXCLUDED.subjects, grades = EXCLUDED.grades,
			keywords = EXCLUDED.keywords, slides_count = EXCLUDED.slides_count, thumbnail = EXCLUDED.thumbnail,
			thumbnail_alt = EXCLUDED.thumbnail_alt, git_commit_sha = EXCLUDED.git_commit_sha,
			played_count = EXCLUDED.played_count, view_count = EXCLUDED.view_count,
			published_at = EXCLUDED.published_at, updated_at = EXCLUDED.updated_at`;
	}

	async deleteFuiz(id: string): Promise<void> {
		await this.sql`DELETE FROM fuizzes WHERE id = ${id}`;
	}

	async getActiveGames(): Promise<ActiveGame[]> {
		return (await this.sql<ActiveGame[]>`SELECT * FROM active_games ORDER BY started_at DESC`).map(
			normalize
		);
	}

	async getActiveGame(quizId: string): Promise<ActiveGame | null> {
		const [row] = await this.sql<
			ActiveGame[]
		>`SELECT * FROM active_games WHERE quiz_id = ${quizId}`;
		return row ? normalize(row) : null;
	}

	async setActiveGame(quizId: string, gameCode: string): Promise<void> {
		await this.sql`INSERT INTO active_games (quiz_id, game_code) VALUES (${quizId}, ${gameCode})
			ON CONFLICT (quiz_id) DO UPDATE SET game_code = EXCLUDED.game_code, started_at = CURRENT_TIMESTAMP`;
	}

	async removeActiveGame(quizId: string): Promise<void> {
		await this.sql`DELETE FROM active_games WHERE quiz_id = ${quizId}`;
	}

	async removeActiveGameByCode(gameCode: string): Promise<void> {
		await this.sql`DELETE FROM active_games WHERE game_code = ${gameCode}`;
	}
}
