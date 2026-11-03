import { requireSameOrigin, requireUser } from '$lib/server/guards';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	requireUser(event);
	requireSameOrigin(event);
	for (const name of ['google', 'oauth_state', 'oauth_return'])
		event.cookies.delete(name, { path: '/' });
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
};
