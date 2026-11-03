import { fail, type RequestEvent, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { localizeHref } from '$lib/paraglide/runtime';
import { getAccountStore } from '$lib/server/accountStore';
import { clearAdminSession, verifySessionToken } from '$lib/server/auth';
import { requireSameOrigin } from '$lib/server/guards';
import { notifyRuntime } from '$lib/server/hostRuntime';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({});
export const actions = {
	default: async (event: RequestEvent) => {
		requireSameOrigin(event);
		const token = verifySessionToken(event.cookies.get('admin_session') ?? '');
		const identity =
			event.locals.user ??
			(token.valid ? { id: token.userId, sessionVersion: token.sessionVersion } : null);
		let confirmed = !identity;
		try {
			if (identity) {
				const store = await getAccountStore(event);
				confirmed = !!store && (await store.revokeSessions(identity.id, identity.sessionVersion));
				if (confirmed)
					await notifyRuntime('/internal/host/revoke', {
						userId: identity.id,
						minSessionVersion: identity.sessionVersion + 1
					});
			}
		} catch {
			confirmed = false;
		}
		// Always clear this browser, but report failed durable revocation: removing a cookie
		// alone cannot invalidate its copies or an already connected host session.
		clearAdminSession(event.cookies);
		for (const cookie of [
			'google',
			'oauth_state',
			'oauth_return',
			'google_account',
			'git_tokens_gitlab',
			'git_tokens_github',
			'git_oauth_state',
			'git_oauth_provider',
			'git_oauth_return'
		])
			event.cookies.delete(cookie, { path: '/' });
		if (!confirmed) return fail(503, { unavailable: true });
		redirect(303, resolve(localizeHref('/')));
	}
} satisfies Actions;
