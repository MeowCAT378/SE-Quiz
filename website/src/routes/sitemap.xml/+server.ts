import type { RequestHandler } from '@sveltejs/kit';
import * as sitemap from 'super-sitemap/sveltekit';
import { base } from '$app/paths';
import { baseLocale, locales } from '$lib/paraglide/runtime';

export const prerender = false;

// Adapt route metadata for super-sitemap v2 without renaming SvelteKit's lang parameter.
const routes = {
	routeFiles: Object.keys(import.meta.glob('/src/routes/**/+page.svelte')).map((path) =>
		path.replace('[[lang=locale]]', '[[locale=locale]]')
	)
};

export const GET: RequestHandler = async ({ url }) => {
	const text = await (
		await sitemap.response({
			...routes,
			origin: url.origin,
			locales: {
				default: baseLocale,
				alternates: locales.filter((locale) => locale !== baseLocale)
			},
			excludeRoutePatterns: [/\[(id|code)\]/],
			processPaths: (paths) =>
				paths.map((entry) => ({
					...entry,
					path: base + entry.path,
					alternates: entry.alternates?.map((alternate) => ({
						...alternate,
						path: base + alternate.path
					}))
				}))
		})
	).text();

	return new Response(text.replaceAll('https://www', 'http://www'), {
		headers: {
			'cache-control': 'max-age=0, s-maxage=3600',
			'content-type': 'text/xml'
		}
	});
};
