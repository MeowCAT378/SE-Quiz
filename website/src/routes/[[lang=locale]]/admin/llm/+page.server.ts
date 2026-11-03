import { isHttpError } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/guards';
import { listLlmConfigurations } from '$lib/server/llmManagement';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireAdmin(event);
	event.setHeaders({ 'cache-control': 'no-store' });
	try {
		return { llm: await listLlmConfigurations(event) };
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		return { llm: null };
	}
};
