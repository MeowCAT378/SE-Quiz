import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { localizeHref } from '$lib/paraglide/runtime';
import { activityAvailable } from '$lib/server/llmService';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals, url } = event;
	if (!locals.user) {
		redirect(
			303,
			resolve(localizeHref(`/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`))
		);
	}
	// The shared layout persists across navigation and can predate an ADMIN's activation.
	return { aiAvailable: await activityAvailable(event) };
};
