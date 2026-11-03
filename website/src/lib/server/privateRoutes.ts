import { isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { requireAdmin, requireSameOrigin, requireUser } from './guards';
import { getPrivateResourceStore } from './privateResourceStore';
import { integer, object, ResourceError, type ResourceKind, valid } from './privateValidation';
import { readJsonBody } from './requestBody';

const response = (body: unknown, status = 200) =>
	json(body, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	});
async function guarded(work: () => Promise<Response>) {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof ResourceError) return response({ error: cause.message }, cause.status);
		if (isHttpError(cause)) return response({ error: cause.body.message }, cause.status);
		// A failed list must not look like an empty snapshot: clients prune caches after success.
		return response({ error: 'Private storage unavailable' }, 503);
	}
}
async function storeFor(event: RequestEvent) {
	const store = await getPrivateResourceStore(event);
	if (!store) throw new ResourceError(503, 'Private storage unavailable');
	return store;
}
export function resourceRoute(event: RequestEvent, kind: ResourceKind, uuid?: string) {
	return guarded(async () => {
		const actor = requireUser(event);
		const method = event.request.method;
		if (method !== 'GET') requireSameOrigin(event);
		const store = await storeFor(event);
		if (method === 'GET') {
			if (!uuid) return response({ resources: await store.list(actor, kind) });
			const record = await store.get(actor, kind, uuid);
			return record ? response(record) : response({ error: 'Private record not found' }, 404);
		}
		const input = await readJsonBody(event.request, 4 * 1024 * 1024);
		if (method === 'POST' && !uuid)
			return response(await store.write(actor, kind, input, null), 201);
		if (method === 'PUT' && uuid) {
			const body = object(input, ['record', 'expectedVersion']);
			integer(body.expectedVersion);
			valid(
				body.record &&
					typeof body.record === 'object' &&
					'uniqueId' in body.record &&
					body.record.uniqueId === uuid
			);
			return response(await store.write(actor, kind, body.record, body.expectedVersion as number));
		}
		if (method === 'DELETE' && uuid) {
			const body = object(input, ['expectedVersion']);
			integer(body.expectedVersion);
			await store.remove(actor, kind, uuid, body.expectedVersion as number);
			return response({ deleted: true });
		}
		return response({ error: 'Method not allowed' }, 405);
	});
}
export function mediaRoute(event: RequestEvent) {
	return guarded(async () => {
		const actor = requireUser(event);
		if (event.request.method !== 'GET') requireSameOrigin(event);
		const store = await storeFor(event);
		const id = event.params.id ?? '';
		if (event.request.method === 'GET') {
			const media = await store.getMedia(actor, id);
			return media ? response(media) : response({ error: 'Private media not found' }, 404);
		}
		if (event.request.method === 'PUT')
			return response(
				await store.putMedia(actor, id, await readJsonBody(event.request, 8 * 1024 * 1024))
			);
		return response({ error: 'Method not allowed' }, 405);
	});
}
export function importRoute(event: RequestEvent) {
	return guarded(async () => {
		const actor = requireAdmin(event);
		requireSameOrigin(event);
		const store = await storeFor(event);
		return response({
			imports: await store.import(actor, await readJsonBody(event.request, 32 * 1024 * 1024))
		});
	});
}
export function gameExportRoute(event: RequestEvent) {
	return guarded(async () => {
		const actor = requireUser(event);
		const game = await (await storeFor(event)).gameForExport(actor, event.params.id ?? '');
		return game ? response(game) : response({ error: 'Owned game instance not found' }, 404);
	});
}
