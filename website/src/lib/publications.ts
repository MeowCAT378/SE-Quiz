import { accountRequest, type Database, StorageError } from '$lib/storage';

export async function getPublishedIds(database: Database): Promise<Set<string>> {
	const response = await accountRequest(database, '/api/admin/publications');
	const body = await response.json();
	if (
		!Array.isArray(body.publishedIds) ||
		!body.publishedIds.every((id: unknown) => typeof id === 'string')
	) {
		throw new StorageError(503);
	}
	return new Set(body.publishedIds);
}
