import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin, requireSameOrigin } from '$lib/server/guards';
import { readJsonBody } from '$lib/server/requestBody';

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	requireSameOrigin(event);
	const { request, locals } = event;
	const { id } = await readJsonBody<{ id: string }>(request);
	if (
		typeof id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
	)
		return json({ error: 'Invalid quiz ID' }, { status: 400 });
	if (!locals.database || !locals.blobStorage)
		return json({ error: 'Library service unavailable' }, { status: 503 });

	try {
		if (!(await locals.database.getById(id)))
			return json({ error: 'Quiz not found' }, { status: 404 });
		await locals.blobStorage.delete(id);
		await locals.database.deleteFuiz(id);

		return json({ success: true, message: 'Quiz deleted successfully.' });
	} catch {
		return json({ error: 'Library service unavailable' }, { status: 503 });
	}
};
