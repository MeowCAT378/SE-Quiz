import { fail, redirect } from '@sveltejs/kit';
import { getAccountStore } from '$lib/server/accountStore';
import { safeReturnPath, setAdminSession } from '$lib/server/auth';
import { requireSameOrigin } from '$lib/server/guards';
import { readFormBody } from '$lib/server/requestBody';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const returnTo = safeReturnPath(url.searchParams.get('returnTo'));
	if (locals.user) {
		redirect(303, returnTo);
	}
	return {
		returnTo,
		credentialType: 'email' as const
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { request, cookies, url } = event;
		requireSameOrigin(event);
		const data = await readFormBody(request);
		const email = (data.get('email')?.toString() ?? '').trim().toLowerCase();
		const password = data.get('password')?.toString() ?? '';
		const returnTo = safeReturnPath(
			url.searchParams.get('returnTo') || data.get('returnTo')?.toString()
		);

		if (!email || !password) {
			return fail(400, {
				missing: true,
				message: 'Please enter email and password'
			});
		}

		const store = await getAccountStore(event);
		if (!store) return fail(503, { message: 'Login unavailable', unavailable: true });
		let result: Awaited<ReturnType<typeof store.login>>;
		try {
			result = await store.login(email, password, event.getClientAddress());
		} catch {
			return fail(503, { message: 'Login unavailable', unavailable: true });
		}
		if (result.retryAfter) {
			event.setHeaders({ 'retry-after': String(result.retryAfter) });
			return fail(429, { message: 'Please retry later', throttled: true });
		}
		if (!result.account) {
			return fail(401, {
				incorrect: true,
				message: 'Invalid email or password'
			});
		}

		// A new local login must not inherit the previous user's external-service credentials.
		for (const name of [
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
			cookies.delete(name, { path: '/' });
		setAdminSession(cookies, result.account, url);
		redirect(303, returnTo);
	}
};
