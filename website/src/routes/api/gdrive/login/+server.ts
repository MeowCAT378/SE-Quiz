import { error } from '@sveltejs/kit';
import { safeReturnPath } from '$lib/server/auth';
import { requireAdmin, requireUser } from '$lib/server/guards';
import { cookieOptions, generateAuthUrl, sealGoogle } from '../driveUtil';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
	const actor = requireUser(event);
	if (
		event.request.headers.get('sec-fetch-site') !== 'same-origin' &&
		event.request.headers.get('origin') !== event.url.origin
	)
		error(403, 'Same-origin navigation required');
	const legacy = event.url.searchParams.get('legacy') === '1';
	if (legacy) requireAdmin(event);
	const state = crypto.randomUUID();
	const returnTo = safeReturnPath(event.url.searchParams.get('return'));
	const location = generateAuthUrl(state);
	event.cookies.set('oauth_state', sealGoogle('state', actor, { state, returnTo, legacy }, 600), {
		...cookieOptions,
		maxAge: 600
	});
	event.cookies.delete('oauth_return', { path: '/' });
	return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
};
