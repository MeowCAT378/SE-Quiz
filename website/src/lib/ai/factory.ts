import type { RequestEvent } from '@sveltejs/kit';
import { loadActivitySnapshot } from '../server/llmService';
import { beginActivityOperation, finishActivityOperation } from './activityOperations';
import type { BaseAI } from './base';

// Optional publication enrichment uses the same ADMIN-selected configuration as activity drafts.
export async function createAI(
	event: RequestEvent
): Promise<Pick<BaseAI, 'generateKeywords'> | undefined> {
	try {
		const snapshot = await loadActivitySnapshot(event);
		return {
			async generateKeywords(systemPrompt, userContent) {
				const controller = beginActivityOperation(
					crypto.randomUUID(),
					`${event.locals.user?.id}:${event.locals.session?.issuedAt}`,
					snapshot.settings.maxConcurrentOperations
				);
				if (!controller) return null;
				try {
					const signal = AbortSignal.any([
						controller.signal,
						event.request.signal,
						AbortSignal.timeout(
							Math.min(
								snapshot.settings.requestTimeoutSeconds,
								snapshot.settings.generationTimeoutSeconds
							) * 1000
						)
					]);
					signal.throwIfAborted();
					const result = await snapshot.provider.generateStructured({
						systemPrompt,
						userContent,
						signal,
						schema: {
							type: 'object',
							properties: {
								keywords: {
									type: 'array',
									minItems: 1,
									maxItems: 16,
									items: { type: 'string', minLength: 1, maxLength: 100 }
								}
							},
							required: ['keywords'],
							additionalProperties: false
						}
					});
					const parsed = JSON.parse(result.content);
					if (
						signal.aborted ||
						!parsed ||
						Object.keys(parsed).length !== 1 ||
						!Array.isArray(parsed.keywords) ||
						!parsed.keywords.length ||
						parsed.keywords.length > 16 ||
						parsed.keywords.some(
							(item: unknown) => typeof item !== 'string' || !item.trim() || item.length > 100
						)
					)
						return null;
					return JSON.stringify([...new Set(parsed.keywords.map((item: string) => item.trim()))]);
				} catch {
					return null;
				} finally {
					finishActivityOperation(controller);
				}
			}
		};
	} catch {
		return undefined;
	}
}
