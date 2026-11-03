import { isHttpError, json } from '@sveltejs/kit';
import { cancelActivityOperation } from '$lib/ai/activityOperations';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { isUuid } from '$lib/server/hostGames';
import { readJsonBody } from '$lib/server/requestBody';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const actor = requireUser(event);
		requireSameOrigin(event);
		const { operationId } = await readJsonBody<{ operationId?: unknown }>(event.request, 1024);
		if (!isUuid(String(operationId))) return json({ error: 'invalid_request' }, { status: 400 });
		const owner = `${actor.id}:${event.locals.session?.issuedAt ?? ''}`;
		return json(
			{ cancelled: cancelActivityOperation(String(operationId), owner) },
			{
				headers: { 'cache-control': 'no-store' }
			}
		);
	} catch (cause) {
		if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
		return json({ error: 'cancellation_failed' }, { status: 503 });
	}
};
