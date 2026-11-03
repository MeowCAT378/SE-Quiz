import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { localizeHref } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(
			303,
			resolve(localizeHref(`/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`))
		);
	}
	return {};
};
