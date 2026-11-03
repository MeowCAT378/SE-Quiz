/**
 * Cloudflare D1 database implementation
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { PublishedFuizDB } from '$lib/types';
import {
	type ActiveGame,
	BaseDatabase,
	type FuizExistingStats,
	type FuizInsertData,
	type SearchFilters
} from './base';
import { buildSearchQuery } from './search';

export class D1DatabaseAdapter extends BaseDatabase {
	private db: D1Database;

	constructor(db: D1Database) {
		super();
		this.db = db;
	}

	async getPublishedIds(): Promise<string[]> {
		const result = await this.db.prepare('SELECT id FROM fuizzes').all<{ id: string }>();
		return result.results.map((row) => row.id);
	}

	async tableExists(): Promise<boolean> {
		try {
			const tableInfo = await this.db.prepare('PRAGMA table_info(fuizzes)').all();
			return tableInfo.results.length > 0;
		} catch {
			return false;
		}
	}

	async getRecentlyPublished(limit: number): Promise<PublishedFuizDB[]> {
		const result = await this.db
			.prepare('SELECT * FROM fuizzes ORDER BY published_at DESC LIMIT ?')
			.bind(limit)
			.all<PublishedFuizDB>();
		return result.results;
	}

	async getById(id: string): Promise<PublishedFuizDB | null> {
		return (
			(await this.db
				.prepare('SELECT * FROM fuizzes WHERE id = ?')
				.bind(id)
				.first<PublishedFuizDB>()) || null
		);
	}

	async search(term: string, filters: SearchFilters, limit: number): Promise<PublishedFuizDB[]> {
		const { sql, params } = buildSearchQuery(term, filters, limit);
		const result = await this.db
			.prepare(sql)
			.bind(...params)
			.all<PublishedFuizDB>();
		return result.results;
	}

	async getDistinctLanguages(): Promise<string[]> {
		const result = await this.db
			.prepare(
				"SELECT DISTINCT language FROM fuizzes WHERE language IS NOT NULL AND language <> '' ORDER BY language"
			)
			.all<{ language: string }>();
		return result.results.map((r) => r.language);
	}

	async getExistingStats(id: string): Promise<FuizExistingStats | null> {
		return (
			(await this.db
				.prepare(
					'SELECT id, played_count, view_count, published_at, git_commit_sha FROM fuizzes WHERE id = ?'
				)
				.bind(id)
				.first<FuizExistingStats>()) || null
		);
	}

	async insertFuiz(data: FuizInsertData): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO fuizzes (
				id, storage_id, title, author, language, subjects, grades,
				keywords, slides_count, thumbnail, thumbnail_alt,
				git_commit_sha, played_count, view_count, published_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT (id) DO UPDATE SET
 storage_id = excluded.storage_id, title = excluded.title, author = excluded.author,
 language = excluded.language, subjects = excluded.subjects, grades = excluded.grades,
 keywords = excluded.keywords, slides_count = excluded.slides_count, thumbnail = excluded.thumbnail,
 thumbnail_alt = excluded.thumbnail_alt, git_commit_sha = excluded.git_commit_sha,
 played_count = excluded.played_count, view_count = excluded.view_count,
 published_at = excluded.published_at, updated_at = excluded.updated_at`
			)
			.bind(
				data.id,
				data.storage_id,
				data.title,
				data.author,
				data.language,
				data.subjects,
				data.grades,
				data.keywords,
				data.slides_count,
				data.thumbnail,
				data.thumbnail_alt,
				data.git_commit_sha,
				data.played_count,
				data.view_count,
				data.published_at,
				data.updated_at
			)
			.run();
	}

	async deleteFuiz(id: string): Promise<void> {
		await this.db.prepare('DELETE FROM fuizzes WHERE id = ?').bind(id).run();
	}

	async getActiveGames(): Promise<ActiveGame[]> {
		try {
			const res = await this.db
				.prepare('SELECT quiz_id, game_code, started_at FROM active_games ORDER BY started_at DESC')
				.all<ActiveGame>();
			return res.results;
		} catch (e) {
			console.error('Failed to get active games from D1:', e);
			return [];
		}
	}

	async getActiveGame(quizId: string): Promise<ActiveGame | null> {
		try {
			return (
				(await this.db
					.prepare('SELECT quiz_id, game_code, started_at FROM active_games WHERE quiz_id = ?')
					.bind(quizId)
					.first<ActiveGame>()) || null
			);
		} catch (e) {
			console.error('Failed to get active game from D1:', e);
			return null;
		}
	}

	async setActiveGame(quizId: string, gameCode: string): Promise<void> {
		await this.db
			.prepare(
				'INSERT OR REPLACE INTO active_games (quiz_id, game_code, started_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
			)
			.bind(quizId, gameCode)
			.run();
	}

	async removeActiveGame(quizId: string): Promise<void> {
		await this.db.prepare('DELETE FROM active_games WHERE quiz_id = ?').bind(quizId).run();
	}

	async removeActiveGameByCode(gameCode: string): Promise<void> {
		await this.db.prepare('DELETE FROM active_games WHERE game_code = ?').bind(gameCode).run();
	}
}
