import { isHttpError, json } from '@sveltejs/kit';
import { generateActivityDrafts, validateGenerationRequest } from '$lib/ai/activityGeneration';
import { beginActivityOperation, finishActivityOperation } from '$lib/ai/activityOperations';
import { AIProviderError } from '$lib/ai/base';
import { LlmError } from '$lib/ai/llmConfiguration';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { isUuid } from '$lib/server/hostGames';
import { loadActivitySnapshot } from '$lib/server/llmService';
import { getPrivateResourceStore } from '$lib/server/privateResourceStore';
import { readJsonBody } from '$lib/server/requestBody';
import type { RequestHandler } from './$types';

const response = (body: unknown, status = 200) =>
	json(body, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	});

function failure(cause: unknown): Response {
	if (isHttpError(cause)) return response({ error: cause.body.message }, cause.status);
	if (cause instanceof LlmError) return response({ error: 'ai_unavailable' }, 503);
	if (cause instanceof AIProviderError) {
		const status = cause.code.endsWith('_timeout')
			? 504
			: cause.code === 'cancelled'
				? 408
				: cause.code === 'invalid_response'
					? 422
					: 503;
		return response({ error: cause.code }, status);
	}
	const code = cause instanceof Error ? cause.message : '';
	if (
		cause instanceof SyntaxError ||
		['invalid_response', 'invalid_items', 'duplicate_items'].includes(code)
	)
		return response({ error: 'invalid_response' }, 422);
	if (code === 'invalid_request') {
		return response({ error: code }, 400);
	}
	return response({ error: 'generation_failed' }, 503);
}

export const POST: RequestHandler = async (event) => {
	try {
		const actor = requireUser(event);
		requireSameOrigin(event);
		const input = await readJsonBody<Record<string, unknown>>(event.request, 8 * 1024);
		const { operationId, creationId, ...settings } = input;
		if (!isUuid(String(operationId)) || !isUuid(String(creationId))) {
			return response({ error: 'invalid_request' }, 400);
		}
		const request = validateGenerationRequest(settings);
		const store = await getPrivateResourceStore(event);
		if (!store) return response({ error: 'storage_unavailable' }, 503);
		if (!(await store.get(actor, 'creation', String(creationId)))) {
			return response({ error: 'creation_not_found' }, 404);
		}
		const owner = `${actor.id}:${event.locals.session?.issuedAt ?? ''}`;
		const snapshot = await loadActivitySnapshot(event);
		const controller = beginActivityOperation(
			String(operationId),
			owner,
			snapshot.settings.maxConcurrentOperations
		);
		if (!controller) return response({ error: 'ai_busy' }, 409);
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			deadline = setTimeout(
				() => controller.abort(new AIProviderError('generation_timeout')),
				snapshot.settings.generationTimeoutSeconds * 1000
			);
			const { drafts, resolvedLanguage, answerLabels } = await generateActivityDrafts(
				snapshot.provider,
				request,
				{
					batchSize: snapshot.settings.batchSize,
					callTimeoutMs: snapshot.settings.requestTimeoutSeconds * 1000,
					signal: controller.signal
				}
			);
			// Generation can outlive access to the creation. Recheck before returning drafts;
			// persistence remains the editor's explicit Add to Activity and normal save flow.
			if (!(await store.get(actor, 'creation', String(creationId)))) {
				return response({ error: 'creation_not_found' }, 404);
			}
			return response({
				operationId,
				drafts,
				resolvedLanguage,
				...(answerLabels ? { answerLabels } : {})
			});
		} finally {
			clearTimeout(deadline);
			finishActivityOperation(controller);
		}
	} catch (cause) {
		return failure(cause);
	}
};
