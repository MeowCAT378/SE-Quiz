import { type RequestHandler, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { localizeHref } from '$lib/paraglide/runtime';
import { actions } from '../../logout/+page.server';

export const GET: RequestHandler = async () => {
	redirect(303, resolve(localizeHref('/logout')));
};

export const POST: RequestHandler = async (event) => {
	const result = await actions.default(event);
	return new Response(JSON.stringify(result.data), {
		status: result.status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});
};
