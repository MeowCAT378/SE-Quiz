import { error, type Handle, redirect } from '@sveltejs/kit';
import { resolve as resolvePath } from '$app/paths';
import { createBlobStorage } from '$lib/blob/factory';
import { createDatabase } from '$lib/db';
import { createKVStore } from '$lib/kv/factory';
import { stripBase } from '$lib/navigation/basePath';
import { deLocalizeUrl, localizeHref } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getAccountStore } from '$lib/server/accountStore';
import { verifySessionToken } from '$lib/server/auth';
import { routePolicy } from '$lib/server/authPolicy';
import { requireAdmin, requireSameOrigin, requireUser } from '$lib/server/guards';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	event.locals.isAdmin = false;
	const token = verifySessionToken(event.cookies.get('admin_session') ?? '');
	if (token.valid) {
		try {
			const store = await getAccountStore(event);
			const user = await store?.findActiveById(token.userId);
			if (
				user &&
				user.sessionVersion === token.sessionVersion &&
				(user.role === 'ADMIN' || user.role === 'TEACHER')
			) {
				event.locals.user = user;
				event.locals.session = {
					issuedAt: token.issuedAt,
					expiresAt: token.expiresAt
				};
				event.locals.isAdmin = user.role === 'ADMIN';
			}
		} catch {
			// Account persistence failures never authorize signature-only sessions.
			event.locals.user = null;
		}
	}
	event.locals.database = await createDatabase(event.platform?.env?.DATABASE);
	event.locals.blobStorage = await createBlobStorage(event.platform?.env?.BUCKET);
	event.locals.shareStore = await createKVStore(event.platform?.env?.MAP, 'kv_share');
	event.locals.publishJobsStore = await createKVStore(
		event.platform?.env?.PUBLISH_JOBS,
		'kv_publish_jobs'
	);
	if (!event.route.id?.startsWith('/[[lang=locale]]')) {
		// If the route is not localized
		const delocalizedUrl = deLocalizeUrl(event.request.url).pathname;
		const originalUrl = new URL(event.request.url).pathname;
		// and the delocalized URL differs from the original URL,
		// return a 404 response
		if (delocalizedUrl !== originalUrl) {
			return new Response(null, {
				status: 404
			});
		}
	}

	return paraglideMiddleware(event.request, async ({ request: localizedRequest, locale }) => {
		event.request = localizedRequest;
		const path = stripBase(deLocalizeUrl(event.url).pathname);
		const policy = routePolicy(path, event.request.method);
		try {
			if (policy !== 'public') {
				if (!event.locals.user) {
					if (path === '/api/gdrive/callback') {
						for (const name of ['google', 'oauth_state', 'oauth_return'])
							event.cookies.delete(name, { path: '/' });
					}
					if (!event.route.id?.startsWith('/[[lang=locale]]'))
						error(401, 'Authentication required');
					const returnTo = encodeURIComponent(event.url.pathname + event.url.search);
					redirect(303, resolvePath(localizeHref(`/login?returnTo=${returnTo}`, { locale })));
				}
				if (policy === 'admin') requireAdmin(event);
				else requireUser(event);
				if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) requireSameOrigin(event);
			}
		} catch (cause) {
			if (/^\/api\/admin\/llm(?:\/|$)/.test(path)) {
				const { llmFailure } = await import('$lib/server/llmManagement');
				return llmFailure(cause);
			}
			throw cause;
		}
		const response = await resolve(event, {
			transformPageChunk: ({ html }) => {
				return html.replace('%paraglide.lang%', locale).replace(
					'%paraglide.textDirection%',
					{
						ar: 'rtl',
						az: 'ltr',
						de: 'ltr',
						en: 'ltr',
						es: 'ltr',
						eu: 'ltr',
						fr: 'ltr',
						id: 'ltr',
						it: 'ltr',
						nl: 'ltr',
						pl: 'ltr',
						th: 'ltr',
						'zh-cn': 'ltr'
					}[locale] ?? 'ltr'
				);
			}
		});
		if (policy !== 'public' || event.locals.user) response.headers.set('Cache-Control', 'no-store');
		return response;
	});
};
