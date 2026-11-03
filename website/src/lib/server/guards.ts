import { error, type RequestEvent } from '@sveltejs/kit';

export function requireUser(
	event: Pick<RequestEvent, 'locals'> & Partial<Pick<RequestEvent, 'request'>>
) {
	if (!event.locals.user || !event.locals.session) error(401, 'Authentication required');
	// These headers reject stale browser work after a login switch; they never authenticate it.
	const account = event.request?.headers.get('x-seopen-account');
	const session = event.request?.headers.get('x-seopen-session');
	if (
		(account && account !== event.locals.user.id) ||
		(session && session !== String(event.locals.session.issuedAt))
	)
		error(401, 'Account changed');
	return event.locals.user;
}
export function requireAdmin(event: Pick<RequestEvent, 'locals'>) {
	const user = requireUser(event);
	if (user.role !== 'ADMIN') error(403, 'Administrator access required');
	return user;
}
export function requireSameOrigin(event: Pick<RequestEvent, 'request' | 'url'>) {
	if (event.request.headers.get('origin') !== event.url.origin)
		error(403, 'Same-origin request required');
}
