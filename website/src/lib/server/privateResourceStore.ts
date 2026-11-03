import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PrivateResourceStore } from './privateResources';

export async function getPrivateResourceStore(
	event: Pick<RequestEvent, 'platform' | 'locals'>
): Promise<PrivateResourceStore | undefined> {
	const d1 = event.platform?.env?.DATABASE;
	const provider = env.DB_PROVIDER || (d1 ? 'd1' : 'postgres');
	if (provider === 'd1' && d1) {
		const { D1PrivateResourceStore } = await import('./privateResourcesD1');
		return new D1PrivateResourceStore(d1, event.locals.blobStorage);
	}
	if (provider === 'postgres' && env.DATABASE_URL) {
		const { getPostgres } = await import('./postgres');
		const { PostgresPrivateResourceStore } = await import('./privateResourcesPostgres');
		return new PostgresPrivateResourceStore(
			getPostgres(env.DATABASE_URL),
			event.locals.blobStorage
		);
	}
	return undefined;
}
