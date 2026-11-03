import type { D1Database } from '@cloudflare/workers-types';
import {
	AccountError,
	type AccountInput,
	type AccountRow,
	type AccountUpdate,
	accountFromRow,
	BaseAccountStore,
	normalizeEmail,
	publicAccount,
	seedValues,
	validateAccountInput,
	validateAccountUpdate
} from './accounts';
import { hashPassword } from './password';

export class D1AccountStore extends BaseAccountStore {
	constructor(private db: D1Database) {
		super();
	}
	async findActiveById(id: string) {
		const row = await this.db
			.prepare('SELECT * FROM admins WHERE id = ? AND deleted_at IS NULL')
			.bind(id)
			.first<AccountRow>();
		return row ? accountFromRow(row) : null;
	}
	async findByEmail(email: string) {
		const row = await this.protectedCredential(normalizeEmail(email));
		return row ? accountFromRow(row) : null;
	}
	protected async protectedCredential(email: string) {
		return this.db.prepare('SELECT * FROM admins WHERE email = ?').bind(email).first<AccountRow>();
	}
	async list() {
		const { results } = await this.db
			.prepare(
				'SELECT id,email,role,created_at,deleted_at,session_version FROM admins ORDER BY created_at,email'
			)
			.all<AccountRow>();
		return results.map((row) => publicAccount(accountFromRow(row)));
	}
	private async activeAdminExists() {
		return !!(await this.db
			.prepare("SELECT id FROM admins WHERE role = 'ADMIN' AND deleted_at IS NULL LIMIT 1")
			.first());
	}
	async seed(email?: string, password?: string) {
		if (await this.activeAdminExists()) return false;
		const values = await seedValues(email, password);
		return this.provision(values.email, values.hash, values.id);
	}
	// Private CLI also uses this for legacy environment passwords, without applying new-password rules.
	async provision(email: string, hash: string, id = crypto.randomUUID()) {
		try {
			const result = await this.db
				.prepare(
					"INSERT INTO admins (id,email,password_hash,role) SELECT ?,?,?,'ADMIN' WHERE NOT EXISTS (SELECT 1 FROM admins WHERE role = 'ADMIN' AND deleted_at IS NULL)"
				)
				.bind(id, email, hash)
				.run();
			return result.meta.changes > 0;
		} catch {
			throw new AccountError(
				409,
				'Administrator provisioning conflict; explicit maintenance is required'
			);
		}
	}
	// Callers embed current actor authority in the write itself; schema.sql triggers enforce
	// last-admin protection and immutable IDs without a separate read/write race.
	private async runMutation(
		query: string,
		params: (string | number | null)[],
		actorId: string,
		actorVersion: number
	) {
		let row: AccountRow | null;
		try {
			row = await this.db
				.prepare(query)
				.bind(...params)
				.first<AccountRow>();
		} catch (error) {
			if (/last active administrator|UNIQUE constraint failed/i.test(String(error)))
				throw new AccountError(409, 'Account conflict or last active administrator');
			throw error;
		}
		if (!row) {
			const actor = await this.findActiveById(actorId);
			if (actor?.role !== 'ADMIN' || actor.sessionVersion !== actorVersion)
				throw new AccountError(403, 'Administrator access required');
			throw new AccountError(404, 'Active account not found');
		}
		return publicAccount(accountFromRow(row));
	}
	async create(actorId: string, actorVersion: number, input: AccountInput) {
		const values = validateAccountInput(input);
		const hash = await hashPassword(values.password);
		return this.runMutation(
			"INSERT INTO admins (id,email,password_hash,role) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM admins WHERE id = ? AND session_version = ? AND role = 'ADMIN' AND deleted_at IS NULL) RETURNING *",
			[crypto.randomUUID(), values.email, hash, values.role, actorId, actorVersion],
			actorId,
			actorVersion
		);
	}
	async update(actorId: string, actorVersion: number, targetId: string, input: AccountUpdate) {
		const values = validateAccountUpdate(input);
		const hash = values.password ? await hashPassword(values.password) : null;
		return this.runMutation(
			"UPDATE admins SET session_version = session_version + CASE WHEN (? IS NOT NULL AND ? != email) OR (? IS NOT NULL AND ? != role) OR ? IS NOT NULL THEN 1 ELSE 0 END, email = COALESCE(?,email), role = COALESCE(?,role), password_hash = COALESCE(?,password_hash) WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM admins AS actor WHERE actor.id = ? AND actor.session_version = ? AND actor.role = 'ADMIN' AND actor.deleted_at IS NULL) RETURNING *",
			[
				values.email ?? null,
				values.email ?? null,
				values.role ?? null,
				values.role ?? null,
				hash,
				values.email ?? null,
				values.role ?? null,
				hash,
				targetId,
				actorId,
				actorVersion
			],
			actorId,
			actorVersion
		);
	}
	async softDelete(actorId: string, actorVersion: number, targetId: string) {
		return this.runMutation(
			"UPDATE admins SET deleted_at = ?, session_version = session_version + 1 WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM admins AS actor WHERE actor.id = ? AND actor.session_version = ? AND actor.role = 'ADMIN' AND actor.deleted_at IS NULL) RETURNING *",
			[new Date().toISOString(), targetId, actorId, actorVersion],
			actorId,
			actorVersion
		);
	}
	async revokeSessions(id: string, expectedVersion: number) {
		const result = await this.db
			.prepare(
				'UPDATE admins SET session_version = session_version + 1 WHERE id = ? AND session_version = ? AND deleted_at IS NULL'
			)
			.bind(id, expectedVersion)
			.run();
		return result.meta.changes > 0;
	}
	protected async reserveLogin(keys: string[], now: number) {
		const results = await this.db.batch<{ attempts: number; expires_at: number }>([
			this.db
				.prepare(
					'DELETE FROM auth_login_limits WHERE key IN (SELECT key FROM auth_login_limits WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)'
				)
				.bind(now),
			this.db
				.prepare(
					'INSERT INTO auth_login_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE MIN(attempts + 1,101) END, expires_at = CASE WHEN expires_at <= ? THEN ? ELSE expires_at END RETURNING attempts,expires_at'
				)
				.bind(keys[0], now + 900000, now, now, now + 900000),
			this.db
				.prepare(
					'INSERT INTO auth_login_limits (key,attempts,expires_at) SELECT ?,1,? WHERE EXISTS (SELECT 1 FROM auth_login_limits WHERE key = ? AND attempts <= 100 AND expires_at > ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE MIN(attempts + 1,101) END, expires_at = CASE WHEN expires_at <= ? THEN ? ELSE expires_at END RETURNING attempts,expires_at'
				)
				.bind(keys[1], now + 900000, keys[0], now, now, now, now + 900000)
		]);
		const rows = results.slice(1).flatMap((result) => result.results);
		return {
			allowed: rows.length === 2 && rows[1].attempts <= 10,
			retryAfter: Math.max(
				1,
				Math.ceil((Math.max(...rows.map((row) => row.expires_at)) - now) / 1000)
			)
		};
	}
	protected async releaseLogin(keys: string[], now: number) {
		await this.db.batch(
			keys.map((key) =>
				this.db
					.prepare(
						'UPDATE auth_login_limits SET attempts = MAX(0,attempts - 1) WHERE key = ? AND expires_at > ? AND expires_at <= ?'
					)
					.bind(key, now, now + 900000)
			)
		);
	}
}
