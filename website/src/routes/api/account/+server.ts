import { json } from '@sveltejs/kit';
import { publicAccount } from '$lib/server/accounts';
import { requireUser } from '$lib/server/guards';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	return json(
		{
			user: publicAccount(requireUser(event)),
			sessionIssuedAt: event.locals.session!.issuedAt
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
