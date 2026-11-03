import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getAccountStore } from '$lib/server/accountStore';
import { AccountError, type AccountUpdate } from '$lib/server/accounts';
import { requireAdmin, requireSameOrigin } from '$lib/server/guards';
import { notifyRuntime } from '$lib/server/hostRuntime';
import { readJsonBody } from '$lib/server/requestBody';

async function mutate(event: Parameters<RequestHandler>[0], deleted: boolean) {
	const actor = requireAdmin(event);
	requireSameOrigin(event);
	const id = event.params.id;
	if (!id) error(400, 'Account identifier required');
	const input = deleted ? {} : await readJsonBody<AccountUpdate>(event.request);
	const store = await getAccountStore(event);
	if (!store) error(503, 'Account service unavailable');
	try {
		const user = deleted
			? await store.softDelete(actor.id, actor.sessionVersion, id)
			: await store.update(actor.id, actor.sessionVersion, id, input);
		try {
			const current = await store.findByEmail(user.email);
			if (current?.id === id)
				await notifyRuntime('/internal/host/revoke', {
					userId: id,
					minSessionVersion: current.sessionVersion
				});
		} catch {
			/* Durable mutation succeeded; authoritative runtime polling still revokes access. */
		}
		return json({ user }, { headers: { 'cache-control': 'no-store' } });
	} catch (cause) {
		if (cause instanceof AccountError) error(cause.status, cause.message);
		error(503, 'Account operation unavailable');
	}
}

export const PATCH: RequestHandler = (event) => mutate(event, false);
export const DELETE: RequestHandler = (event) => mutate(event, true);
