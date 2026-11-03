import { error, json, type RequestHandler } from '@sveltejs/kit';
import { stripBase } from '$lib/navigation/basePath';
import { verifyServiceRequest } from '$lib/server/hostAuthorization';
import { getHostGameStore } from '$lib/server/hostGameStore';
import { isGameCode, isUuid } from '$lib/server/hostGames';
import { readTextBody } from '$lib/server/requestBody';

export const POST: RequestHandler = async (event) => {
	const body = await readTextBody(event.request, 2048);
	if (
		!verifyServiceRequest(
			event.request.headers.get('x-seopen-service-proof'),
			'POST',
			stripBase(event.url.pathname),
			body
		)
	)
		error(401, 'Service authentication required');
	let input: unknown;
	try {
		input = JSON.parse(body);
	} catch {
		error(400, 'Invalid completion');
	}
	if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, 'Invalid completion');
	const value = input as Record<string, unknown>;
	if (
		Object.keys(value).length !== 4 ||
		!isUuid(value.instanceId) ||
		!isUuid(value.ownerId) ||
		!isUuid(value.watcherId) ||
		!isGameCode(value.gameCode)
	)
		error(400, 'Invalid completion');
	const store = await getHostGameStore(event);
	if (!store) error(503, 'Game store unavailable');
	if (!(await store.complete(value.instanceId, value.gameCode, value.ownerId, value.watcherId)))
		error(404, 'Game binding not found');
	return json({ completed: true });
};
