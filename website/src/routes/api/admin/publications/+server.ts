import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/guards';

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const headers = { 'cache-control': 'no-store' };
	try {
		if (!event.locals.database) throw new Error('Unavailable');
		return json({ publishedIds: await event.locals.database.getPublishedIds() }, { headers });
	} catch {
		return json({ error: 'Library service unavailable' }, { status: 503, headers });
	}
};
