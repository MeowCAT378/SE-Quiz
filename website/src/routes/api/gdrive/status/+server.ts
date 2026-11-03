import { json } from '@sveltejs/kit';
import { getToken, options } from '../driveUtil';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
	const token = getToken(event);
	const { clientId, clientSecret, redirectUri } = options();
	return json(
		{
			authenticated: !!token,
			legacy: !!token?.legacy,
			available: !!(clientId && clientSecret && redirectUri)
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
