import { error } from '@sveltejs/kit';
import { getAccountStore } from '$lib/server/accountStore';
import { requireAdmin } from '$lib/server/guards';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const actor = requireAdmin(event);
	event.setHeaders({ 'cache-control': 'no-store' });
	try {
		const store = await getAccountStore(event);
		if (!store) error(503, 'Account service unavailable');
		return {
			users: (await store.list()).filter((user) => !user.deletedAt),
			currentUserId: actor.id
		};
	} catch {
		error(503, 'Account service unavailable');
	}
};
