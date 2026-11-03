import type { SQL } from 'bun';
import { BaseKVStore, type KVPutOptions } from './base';

export class PostgresKVStore extends BaseKVStore {
	constructor(
		private sql: SQL,
		private namespace: string
	) {
		super();
	}

	async get<T>(key: string, format?: 'text' | 'json'): Promise<T | null> {
		const [row] = await this.sql<{ value: string }[]>`SELECT value FROM kv_entries
			WHERE namespace = ${this.namespace} AND key = ${key}
			AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`;
		if (!row) return null;
		return format === 'json' ? (JSON.parse(row.value) as T) : (row.value as T);
	}

	async put(key: string, value: string, options?: KVPutOptions): Promise<void> {
		const ttl = options?.expirationTtl;
		if (ttl !== undefined && (!Number.isFinite(ttl) || ttl < 0))
			throw new Error('Invalid KV expirationTtl');
		await this.sql`INSERT INTO kv_entries (namespace, key, value, expires_at)
			VALUES (${this.namespace}, ${key}, ${value}, CURRENT_TIMESTAMP + ${ttl ?? null} * INTERVAL '1 second')
			ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`;
		// Read predicates enforce TTL even before this opportunistic physical cleanup runs.
		if (Math.random() < 0.01)
			await this.sql`DELETE FROM kv_entries WHERE expires_at <= CURRENT_TIMESTAMP`;
	}

	async delete(key: string): Promise<void> {
		await this.sql`DELETE FROM kv_entries WHERE namespace = ${this.namespace} AND key = ${key}`;
	}
}
