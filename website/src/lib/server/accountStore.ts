import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { BaseAccountStore } from './accounts';

export async function getAccountStore(
	event: Pick<RequestEvent, 'platform'>
): Promise<BaseAccountStore | undefined> {
	const d1 = event.platform?.env?.DATABASE;
	const provider = env.DB_PROVIDER || (d1 ? 'd1' : 'postgres');
	if (provider === 'd1' && d1) {
		const { D1AccountStore } = await import('./accountsD1');
		return new D1AccountStore(d1);
	}
	if (provider === 'postgres' && env.DATABASE_URL) {
		const { getPostgres } = await import('./postgres');
		const { PostgresAccountStore } = await import('./accountsPostgres');
		return new PostgresAccountStore(getPostgres(env.DATABASE_URL));
	}
	return undefined;
}
