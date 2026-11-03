import type { SQL } from 'bun';

let pool: SQL | undefined;

/** One lazy pool shared by all self-hosted providers in this process. */
export function getPostgres(url: string): SQL {
	if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
	if (typeof Bun === 'undefined') throw new Error('PostgreSQL providers require the Bun runtime');
	pool ??= new Bun.SQL(url, {
		adapter: 'postgres',
		max: 10,
		idleTimeout: 30,
		connectionTimeout: 5
	});
	return pool;
}
