/**
 * Database factory
 * Creates appropriate database instance based on DB_PROVIDER environment variable
 */

import type { D1Database } from '@cloudflare/workers-types';
import { env } from '$env/dynamic/private';
import type { BaseDatabase } from './base';

export type DatabaseProvider = 'd1' | 'postgres';

/**
 * Create a database instance based on environment configuration
 *
 * Environment variables:
 *   DB_PROVIDER: 'd1' | 'postgres' (defaults to 'd1' if D1 binding exists)
 *   DATABASE_URL: private PostgreSQL connection URL
 */
export async function createDatabase(d1Binding?: D1Database): Promise<BaseDatabase | undefined> {
	const provider = (env.DB_PROVIDER as DatabaseProvider) || (d1Binding ? 'd1' : 'postgres');

	switch (provider) {
		case 'd1': {
			if (!d1Binding) {
				console.error('DB_PROVIDER is d1 but no D1 binding found');
				return undefined;
			}
			const { D1DatabaseAdapter } = await import('./d1');
			return new D1DatabaseAdapter(d1Binding);
		}
		case 'postgres': {
			const dbPath = env.DATABASE_URL;
			if (!dbPath) {
				console.error('DB_PROVIDER is postgres but DATABASE_URL is not set');
				return undefined;
			}
			const { PostgresDatabase } = await import('./postgres');
			const { getPostgres } = await import('../server/postgres');
			return new PostgresDatabase(await getPostgres(dbPath));
		}
		default:
			console.error(`Unknown DB_PROVIDER: ${provider}`);
			return undefined;
	}
}
