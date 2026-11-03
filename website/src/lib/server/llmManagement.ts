import { isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { generateActivityDrafts } from '../ai/activityGeneration';
import { beginActivityOperation, finishActivityOperation } from '../ai/activityOperations';
import { AIProviderError } from '../ai/base';
import { LlmError, validateLlmSettings } from '../ai/llmConfiguration';
import { requireAdmin, requireSameOrigin } from './guards';
import { isUuid } from './hostGames';
import { createLlmProvider, discoverLlmModels } from './llmProviders';
import {
	importLegacyLlm,
	legacyLlmPreview,
	llmTransport,
	resolveLlmCredential
} from './llmService';
import { getLlmStore } from './llmStoreFactory';
import { readJsonBody } from './requestBody';

export const llmJson = (body: unknown, status = 200) =>
	json(body, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	});
export function llmFailure(cause: unknown) {
	if (isHttpError(cause))
		return llmJson(
			{
				error:
					cause.status === 401
						? 'authentication_required'
						: cause.status === 403
							? 'administrator_required'
							: 'invalid_configuration'
			},
			cause.status
		);
	if (cause instanceof LlmError)
		return llmJson({ error: cause.code, field: cause.field }, cause.status);
	if (cause instanceof AIProviderError)
		return llmJson(
			{ error: cause.code },
			['request_timeout', 'generation_timeout'].includes(cause.code) ? 504 : 422
		);
	if (
		cause instanceof SyntaxError ||
		(cause instanceof Error &&
			['invalid_items', 'duplicate_items', 'invalid_response'].includes(cause.message))
	)
		return llmJson({ error: 'invalid_response' }, 422);
	return llmJson({ error: 'configuration_unavailable' }, 503);
}
export async function listLlmConfigurations(event: RequestEvent) {
	const actor = requireAdmin(event);
	const list = await (await getLlmStore(event)).list(actor);
	return {
		...list,
		actorId: actor.id,
		sessionIssuedAt: event.locals.session!.issuedAt,
		legacy: list.established ? null : legacyLlmPreview()
	};
}
function version(value: unknown): number;
function version(value: unknown, nullable: true): number | null;
function version(value: unknown, nullable = false): number | null {
	if (nullable && value === null) return null;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new LlmError('invalid_configuration');
	return value;
}
export async function mutateLlm(event: RequestEvent, action: string) {
	const actor = requireAdmin(event);
	requireSameOrigin(event);
	const input = await readJsonBody<Record<string, unknown>>(event.request, 32 * 1024);
	const store = await getLlmStore(event);
	await store.assertAdmin(actor);
	if (action === 'import') return { configuration: await importLegacyLlm(event, actor) };
	if (action === 'delete') {
		if (typeof input.id !== 'string' || !isUuid(input.id))
			throw new LlmError('invalid_configuration');
		await store.remove(
			actor,
			input.id,
			version(input.expectedVersion),
			version(input.expectedSelectionVersion)
		);
		return { deleted: true };
	}
	if (action === 'audit') {
		if (typeof input.id !== 'string' || !isUuid(input.id))
			throw new LlmError('invalid_configuration');
		return { audit: await store.audit(actor, input.id) };
	}
	if (action === 'select') {
		if (input.id !== null && (typeof input.id !== 'string' || !isUuid(input.id)))
			throw new LlmError('invalid_configuration');
		await store.select(
			actor,
			input.id as string | null,
			version(input.expectedConfigurationVersion, true),
			version(input.expectedSelectionVersion)!
		);
		return { saved: true };
	}
	if (!['save', 'test', 'models'].includes(action))
		throw new LlmError('invalid_configuration', 404);
	const settings = validateLlmSettings(input.settings, action === 'models');
	const transport = llmTransport(event, settings);
	if (input.id !== null && (typeof input.id !== 'string' || !isUuid(input.id)))
		throw new LlmError('invalid_configuration');
	const id = input.id === null ? crypto.randomUUID() : (input.id as string);
	const expected = version(input.expectedVersion, true);
	const previous = input.id === null ? undefined : await store.get(id);
	if ((previous?.configuration.version ?? null) !== expected || (input.id !== null && !previous))
		throw new LlmError('configuration_conflict', 409);
	const credential = await resolveLlmCredential(
		event,
		id,
		settings,
		input.credential,
		previous,
		action === 'save'
	);
	if (action === 'save')
		return {
			configuration: await store.save(
				actor,
				id,
				expected,
				settings,
				credential.encryptedKey,
				credential.action
			)
		};
	const deadline = AbortSignal.timeout(
		Math.min(settings.requestTimeoutSeconds, settings.generationTimeoutSeconds, 60) * 1000
	);
	const signal = AbortSignal.any([deadline, event.request.signal]);
	if (action === 'models') {
		const models = await discoverLlmModels(settings, credential.key, transport, signal);
		await store.assertAdmin(actor);
		return { models, limit: 100 };
	}
	const controller = beginActivityOperation(
		crypto.randomUUID(),
		`${actor.id}:${event.locals.session?.issuedAt}`,
		settings.maxConcurrentOperations
	);
	if (!controller) throw new LlmError('ai_busy', 409);
	try {
		await generateActivityDrafts(
			createLlmProvider(settings, credential.key, transport),
			{
				activityType: 'multiple_choice',
				topic: 'Basic arithmetic',
				instructions: 'One short addition question.',
				language: 'en',
				itemCount: 1,
				choicesPerItem: 2,
				difficulty: 'easy'
			},
			{
				batchSize: 1,
				callTimeoutMs:
					Math.min(settings.requestTimeoutSeconds, settings.generationTimeoutSeconds, 60) * 1000,
				maxAttempts: 1,
				signal: AbortSignal.any([signal, controller.signal])
			}
		);
		await store.assertAdmin(actor);
		if (previous && (await store.get(id))?.configuration.version !== expected)
			throw new LlmError('configuration_conflict', 409);
		return { tested: true, configurationVersion: expected, testedAt: new Date().toISOString() };
	} finally {
		finishActivityOperation(controller);
	}
}
