/**
 * KV store factory
 * Creates appropriate KV store instance based on KV_PROVIDER environment variable
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { env } from '$env/dynamic/private';
import type { BaseKVStore } from './base';

export type KVProvider = 'cloudflare' | 'postgres';

/**
 * Create a KV store instance based on environment configuration
 *
 * Environment variables:
 *   KV_PROVIDER: 'cloudflare' | 'postgres' (defaults to 'cloudflare' if a binding exists)
 *   DATABASE_URL: shared private PostgreSQL connection URL
 *
 * @param kvBinding - Cloudflare KV namespace binding (optional)
 * @param namespace - PostgreSQL namespace to avoid key collisions
 */
export async function createKVStore(
	kvBinding?: KVNamespace,
	namespace?: string
): Promise<BaseKVStore | undefined> {
	const provider = (env.KV_PROVIDER as KVProvider) || (kvBinding ? 'cloudflare' : 'postgres');

	switch (provider) {
		case 'cloudflare': {
			if (!kvBinding) {
				console.error('KV_PROVIDER is cloudflare but no KV binding found');
				return undefined;
			}
			const { CloudflareKVStore } = await import('./cloudflare');
			return new CloudflareKVStore(kvBinding);
		}
		case 'postgres': {
			const dbPath = env.DATABASE_URL;
			if (!dbPath) {
				console.error('KV_PROVIDER is postgres but DATABASE_URL is not set');
				return undefined;
			}
			if (!namespace) {
				console.error('KV_PROVIDER is postgres but no namespace provided');
				return undefined;
			}
			const { PostgresKVStore } = await import('./postgres');
			const { getPostgres } = await import('../server/postgres');
			return new PostgresKVStore(await getPostgres(dbPath), namespace);
		}
		default:
			console.error(`Unknown KV_PROVIDER: ${provider}`);
			return undefined;
	}
}
