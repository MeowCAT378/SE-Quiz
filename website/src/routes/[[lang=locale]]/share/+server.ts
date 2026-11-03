import { error, json } from '@sveltejs/kit';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { readJsonBody } from '$lib/server/requestBody';
import type { IdlessFullFuizConfig } from '$lib/types';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async (event) => {
	requireUser(event);
	requireSameOrigin(event);
	const { request, locals } = event;
	if (!locals.shareStore) {
		error(503, 'Share functionality is not configured');
	}

	const config = await readJsonBody<IdlessFullFuizConfig>(request, 4 * 1024 * 1024);

	const id = crypto.randomUUID();

	await locals.shareStore.put(id, JSON.stringify(config), {
		expirationTtl: 60 * 60 * 24 * 30
	});

	return json(id);
};
