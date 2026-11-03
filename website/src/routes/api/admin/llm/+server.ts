import { listLlmConfigurations, llmFailure, llmJson } from '$lib/server/llmManagement';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		return llmJson(await listLlmConfigurations(event));
	} catch (cause) {
		return llmFailure(cause);
	}
};
