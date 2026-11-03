import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

export type AccountRole = 'TEACHER' | 'ADMIN';
export type Account = {
	id: string;
	email: string;
	role: AccountRole;
	createdAt: string;
	deletedAt: string | null;
	sessionVersion: number;
};
export type PublicAccount = Omit<Account, 'sessionVersion'>;
export type AccountInput = { email: string; password: string; role?: AccountRole };
export type AccountUpdate = { email?: string; password?: string; role?: AccountRole };
export type AccountRow = {
	id: string;
	email: string;
	role: AccountRole;
	created_at: string | Date;
	deleted_at: string | Date | null;
	session_version: number;
	password_hash?: string;
};

export class AccountError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}
export function publicAccount(account: Account): PublicAccount {
	const { id, email, role, createdAt, deletedAt } = account;
	return { id, email, role, createdAt, deletedAt };
}
export function accountFromRow(row: AccountRow): Account {
	return {
		id: row.id,
		email: row.email,
		role: row.role,
		createdAt: new Date(row.created_at).toISOString(),
		deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
		sessionVersion: Number(row.session_version)
	};
}
export function validateAccountInput(input: AccountInput): AccountInput & { role: AccountRole } {
	const update = validateAccountUpdate(input);
	if (!update.email || !update.password)
		throw new AccountError(400, 'Email and password are required');
	return { email: update.email, password: update.password, role: update.role ?? 'TEACHER' };
}
export function validateAccountUpdate(input: AccountUpdate): AccountUpdate {
	if (
		!input ||
		typeof input !== 'object' ||
		Object.keys(input).some((key) => !['email', 'password', 'role'].includes(key))
	)
		throw new AccountError(400, 'Invalid account fields');
	const result: AccountUpdate = {};
	if (input.email !== undefined) {
		if (typeof input.email !== 'string') throw new AccountError(400, 'Invalid email');
		result.email = normalizeEmail(input.email);
		if (result.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))
			throw new AccountError(400, 'Invalid email');
	}
	if (input.role !== undefined) {
		if (input.role !== 'TEACHER' && input.role !== 'ADMIN')
			throw new AccountError(400, 'Invalid role');
		result.role = input.role;
	}
	if (input.password !== undefined && input.password !== '') {
		if (
			typeof input.password !== 'string' ||
			[...input.password].length < 12 ||
			Buffer.byteLength(input.password, 'utf8') > 1024
		)
			throw new AccountError(
				400,
				'Password must have at least 12 characters and at most 1024 UTF-8 bytes'
			);
		result.password = input.password;
	}
	return result;
}

// A valid synthetic PBKDF2 hash ensures unknown/deleted users perform the same derivation.
const DUMMY_HASH =
	'pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export abstract class BaseAccountStore {
	abstract findActiveById(id: string): Promise<Account | null>;
	abstract findByEmail(email: string): Promise<Account | null>;
	protected abstract protectedCredential(email: string): Promise<AccountRow | null>;
	abstract list(): Promise<PublicAccount[]>;
	abstract seed(email?: string, password?: string): Promise<boolean>;
	abstract create(
		actorId: string,
		actorVersion: number,
		input: AccountInput
	): Promise<PublicAccount>;
	abstract update(
		actorId: string,
		actorVersion: number,
		targetId: string,
		input: AccountUpdate
	): Promise<PublicAccount>;
	abstract softDelete(
		actorId: string,
		actorVersion: number,
		targetId: string
	): Promise<PublicAccount>;
	abstract revokeSessions(id: string, expectedVersion: number): Promise<boolean>;
	protected abstract reserveLogin(
		keys: string[],
		now: number
	): Promise<{ allowed: boolean; retryAfter: number }>;
	protected abstract releaseLogin(keys: string[], now: number): Promise<void>;
	async authenticate(email: string, password: string): Promise<Account | null> {
		// Login accepts legacy passwords up to the request limit, without applying replacement rules.
		if (
			typeof email !== 'string' ||
			typeof password !== 'string' ||
			Buffer.byteLength(password, 'utf8') > 65536
		)
			return null;
		const row = await this.protectedCredential(normalizeEmail(email));
		const active = row && row.deleted_at === null;
		const verified = await verifyPassword(
			password,
			active ? (row.password_hash ?? DUMMY_HASH) : DUMMY_HASH
		);
		return active && verified ? accountFromRow(row) : null;
	}
	async login(
		email: string,
		password: string,
		address: string
	): Promise<{ account: Account | null; retryAfter: number }> {
		const digest = (value: string) => createHash('sha256').update(value).digest('hex');
		const keys = [
			digest(`address:${address}`),
			digest(`pair:${JSON.stringify([normalizeEmail(email), address])}`)
		];
		const now = Date.now();
		// Reserve before expensive password verification so concurrent attempts share the limit.
		const reservation = await this.reserveLogin(keys, now);
		if (!reservation.allowed) return { account: null, retryAfter: reservation.retryAfter };
		const account = await this.authenticate(email, password);
		if (account) await this.releaseLogin(keys, now);
		return { account, retryAfter: 0 };
	}
}

export async function seedValues(email?: string, password?: string) {
	if (!email || !password)
		throw new AccountError(503, 'Initial administrator credentials are required');
	const values = validateAccountInput({ email, password, role: 'ADMIN' });
	return { ...values, id: crypto.randomUUID(), hash: await hashPassword(values.password) };
}
