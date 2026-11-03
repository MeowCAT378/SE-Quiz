import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { BaseHostGameStore } from './hostGames';

export async function getHostGameStore(
	event: Pick<RequestEvent, 'platform'>
): Promise<BaseHostGameStore | undefined> {
	const d1 = event.platform?.env?.DATABASE;
	const provider = env.DB_PROVIDER || (d1 ? 'd1' : 'postgres');
	if (provider === 'd1' && d1) {
		const { D1HostGameStore } = await import('./hostGamesD1');
		return new D1HostGameStore(d1);
	}
	if (provider === 'postgres' && env.DATABASE_URL) {
		const { getPostgres } = await import('./postgres');
		const { PostgresHostGameStore } = await import('./hostGamesPostgres');
		return new PostgresHostGameStore(getPostgres(env.DATABASE_URL));
	}
	return undefined;
}
