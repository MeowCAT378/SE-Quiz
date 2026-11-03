import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/guards';
import { fixPublish } from '$lib/serverOnlyUtils';
import type { FullOnlineFuiz } from '$lib/types';

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const { params, locals } = event;
	const id = params.id;
	if (!id) {
		return json({ error: 'Quiz ID required.' }, { status: 400 });
	}

	const published = await locals.database?.getById(id);
	if (!published) return json({ error: 'Quiz file not found.' }, { status: 404 });
	let storageId = id;

	if (published) {
		storageId = String(published.storage_id || published.id);
	}

	let raw = await locals.blobStorage?.get(storageId);
	if (!raw && published?.id && published.id !== storageId) {
		raw = await locals.blobStorage?.get(published.id);
	}

	if (!raw) {
		return json({ error: 'Quiz file not found.' }, { status: 404 });
	}

	let onlineFuiz: FullOnlineFuiz | undefined;
	try {
		onlineFuiz = JSON.parse(raw);
	} catch {
		return json({ error: 'Corrupted quiz data.' }, { status: 500 });
	}

	return json({
		id,
		fuiz: published ? fixPublish(published) : undefined,
		config: onlineFuiz?.config
	});
};
