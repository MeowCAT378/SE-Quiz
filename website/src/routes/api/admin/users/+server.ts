import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getAccountStore } from '$lib/server/accountStore';
import { AccountError, type AccountInput } from '$lib/server/accounts';
import { requireAdmin, requireSameOrigin } from '$lib/server/guards';
import { readJsonBody } from '$lib/server/requestBody';

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	try {
		const store = await getAccountStore(event);
		if (!store) error(503, 'Account service unavailable');
		return json({ users: await store.list() }, { headers: { 'cache-control': 'no-store' } });
	} catch {
		error(503, 'Account service unavailable');
	}
};

export const POST: RequestHandler = async (event) => {
	const actor = requireAdmin(event);
	requireSameOrigin(event);
	const input = await readJsonBody<AccountInput>(event.request);
	const store = await getAccountStore(event);
	if (!store) error(503, 'Account service unavailable');
	try {
		return json(
			{ user: await store.create(actor.id, actor.sessionVersion, input) },
			{ status: 201, headers: { 'cache-control': 'no-store' } }
		);
	} catch (cause) {
		if (cause instanceof AccountError) error(cause.status, cause.message);
		error(503, 'Account operation unavailable');
	}
};
