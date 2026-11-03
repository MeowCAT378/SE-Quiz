import type { SQL } from 'bun';
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

export class PostgresAccountStore extends BaseAccountStore {
	constructor(private sql: SQL) {
		super();
	}
	async findActiveById(id: string) {
		const [row] = await this.sql<
			AccountRow[]
		>`SELECT * FROM admins WHERE id = ${id} AND deleted_at IS NULL`;
		return row ? accountFromRow(row) : null;
	}
	async findByEmail(email: string) {
		const row = await this.protectedCredential(normalizeEmail(email));
		return row ? accountFromRow(row) : null;
	}
	protected async protectedCredential(email: string) {
		const [row] = await this.sql<AccountRow[]>`SELECT * FROM admins WHERE email = ${email}`;
		return row ?? null;
	}
	async list() {
		const rows = await this.sql<
			AccountRow[]
		>`SELECT id,email,role,created_at,deleted_at,session_version FROM admins ORDER BY created_at,email`;
		return rows.map((row) => publicAccount(accountFromRow(row)));
	}
	private async mutation<T>(work: (tx: SQL) => Promise<T>): Promise<T> {
		try {
			return (await this.sql.begin(async (tx) => {
				// ponytail: serialize infrequent account management; use finer locks if management throughput matters.
				await tx`LOCK TABLE admins IN SHARE ROW EXCLUSIVE MODE`;
				return work(tx);
			})) as T;
		} catch (error) {
			if (error instanceof AccountError) throw error;
			if ((error as { errno?: string }).errno === '23505')
				throw new AccountError(409, 'Email is already reserved');
			throw error;
		}
	}
	private async actor(tx: SQL, id: string, version: number) {
		const [row] =
			await tx`SELECT id FROM admins WHERE id = ${id} AND session_version = ${version} AND role = 'ADMIN' AND deleted_at IS NULL`;
		if (!row) throw new AccountError(403, 'Administrator access required');
	}
	async seed(email?: string, password?: string) {
		return this.mutation(async (tx) => {
			if (
				(await tx`SELECT id FROM admins WHERE role = 'ADMIN' AND deleted_at IS NULL LIMIT 1`).length
			)
				return false;
			const values = await seedValues(email, password);
			if ((await tx`SELECT id FROM admins WHERE email = ${values.email}`).length)
				throw new AccountError(
					409,
					'Initial administrator email belongs to an existing account; maintenance is required'
				);
			await tx`INSERT INTO admins (id,email,password_hash,role) VALUES (${values.id},${values.email},${values.hash},'ADMIN')`;
			return true;
		});
	}
	async create(actorId: string, actorVersion: number, input: AccountInput) {
		const values = validateAccountInput(input);
		const hash = await hashPassword(values.password);
		return this.mutation(async (tx) => {
			await this.actor(tx, actorId, actorVersion);
			const [row] = await tx<
				AccountRow[]
			>`INSERT INTO admins (id,email,password_hash,role) VALUES (${crypto.randomUUID()},${values.email},${hash},${values.role}) RETURNING *`;
			return publicAccount(accountFromRow(row));
		});
	}
	async update(actorId: string, actorVersion: number, targetId: string, input: AccountUpdate) {
		const values = validateAccountUpdate(input);
		const hash = values.password ? await hashPassword(values.password) : null;
		return this.change(actorId, actorVersion, targetId, values, hash, false);
	}
	async softDelete(actorId: string, actorVersion: number, targetId: string) {
		return this.change(actorId, actorVersion, targetId, {}, null, true);
	}
	private async change(
		actorId: string,
		actorVersion: number,
		targetId: string,
		values: AccountUpdate,
		hash: string | null,
		deleted: boolean
	) {
		return this.mutation(async (tx) => {
			// Recheck the administrator under the mutation lock; the request's identity may be stale.
			await this.actor(tx, actorId, actorVersion);
			const [target] = await tx<
				AccountRow[]
			>`SELECT * FROM admins WHERE id = ${targetId} AND deleted_at IS NULL`;
			if (!target) throw new AccountError(404, 'Active account not found');
			if (target.role === 'ADMIN' && (deleted || values.role === 'TEACHER')) {
				const [count] =
					await tx`SELECT count(*)::int AS count FROM admins WHERE role = 'ADMIN' AND deleted_at IS NULL`;
				if (count.count <= 1)
					throw new AccountError(409, 'The last active administrator cannot be removed');
			}
			if (
				!deleted &&
				!hash &&
				(!values.email || values.email === target.email) &&
				(!values.role || values.role === target.role)
			)
				return publicAccount(accountFromRow(target));
			const [row] = await tx<
				AccountRow[]
			>`UPDATE admins SET email = ${values.email ?? target.email}, role = ${values.role ?? target.role}, password_hash = COALESCE(${hash}, password_hash), deleted_at = ${deleted ? new Date() : null}, session_version = session_version + 1 WHERE id = ${targetId} RETURNING *`;
			return publicAccount(accountFromRow(row));
		});
	}
	async revokeSessions(id: string, expectedVersion: number) {
		const rows = await this
			.sql`UPDATE admins SET session_version = session_version + 1 WHERE id = ${id} AND session_version = ${expectedVersion} AND deleted_at IS NULL RETURNING id`;
		return rows.length > 0;
	}
	protected async reserveLogin(keys: string[], now: number) {
		return (await this.sql.begin(async (tx) => {
			await tx`DELETE FROM auth_login_limits WHERE key IN (SELECT key FROM auth_login_limits WHERE expires_at <= ${now} ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`;
			// Lock order is address then pair for every login; concurrent requests reserve their verification slot.
			const rows: { attempts: number; expires_at: number }[] = [];
			for (const key of keys) {
				const [row] =
					await tx`INSERT INTO auth_login_limits (key, attempts, expires_at) VALUES (${key}, 1, ${now + 900000}) ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN auth_login_limits.expires_at <= ${now} THEN 1 ELSE LEAST(auth_login_limits.attempts + 1, 101) END, expires_at = CASE WHEN auth_login_limits.expires_at <= ${now} THEN ${now + 900000} ELSE auth_login_limits.expires_at END RETURNING attempts,expires_at`;
				rows.push(row);
				if (rows.length === 1 && row.attempts > 100) break;
			}
			return {
				allowed: rows.length === 2 && rows[1].attempts <= 10,
				retryAfter: Math.max(
					1,
					Math.ceil((Math.max(...rows.map((row) => Number(row.expires_at))) - now) / 1000)
				)
			};
		})) as { allowed: boolean; retryAfter: number };
	}
	protected async releaseLogin(keys: string[], now: number) {
		for (const key of keys)
			await this
				.sql`UPDATE auth_login_limits SET attempts = GREATEST(0, attempts - 1) WHERE key = ${key} AND expires_at > ${now} AND expires_at <= ${now + 900000}`;
	}
}
