import { error } from '@sveltejs/kit';
import { safeReturnPath } from '$lib/server/auth';
import { requireAdmin, requireUser } from '$lib/server/guards';
import { exchangeCodeForTokens, openGoogle, storeToken } from '../driveUtil';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
	const stored = event.cookies.get('oauth_state');
	event.cookies.delete('oauth_state', { path: '/' });
	event.cookies.delete('oauth_return', { path: '/' });
	const actor = requireUser(event);
	const state = openGoogle<{ state: string; returnTo: string; legacy: boolean }>(
		stored,
		'state',
		actor
	);
	if (!state || state.state !== event.url.searchParams.get('state')) {
		event.cookies.delete('google', { path: '/' });
		error(403, 'OAuth state invalid');
	}
	if (state.legacy) requireAdmin(event);
	const code = event.url.searchParams.get('code');
	if (!code || event.url.searchParams.has('error')) error(400, 'OAuth authorization failed');
	let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
	try {
		tokens = await exchangeCodeForTokens(code);
	} catch {
		error(503, 'OAuth connection unavailable');
	}
	if (!tokens.access_token) error(503, 'OAuth connection unavailable');
	storeToken(event.cookies, actor, tokens, state.legacy);
	return new Response(null, {
		status: 302,
		headers: { location: safeReturnPath(state.returnTo), 'cache-control': 'no-store' }
	});
};
