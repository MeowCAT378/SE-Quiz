import { llmFailure, llmJson, mutateLlm } from '$lib/server/llmManagement';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		return llmJson(await mutateLlm(event, event.params.action));
	} catch (cause) {
		return llmFailure(cause);
	}
};
