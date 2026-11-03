import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

import {
	LlmError,
	type LlmSettings,
	llmCapabilities,
	llmDefaults,
	validateLlmSettings
} from '../ai/llmConfiguration';
import { decryptLlmKey, encryptLlmKey, validateLlmSecret } from './llmCrypto';
import { validateLlmEndpoint } from './llmDestinations';
import { createLlmProvider } from './llmProviders';
import type { StoredLlm } from './llmStore';
import { getLlmStore } from './llmStoreFactory';
import { createLlmTransport } from './llmTransport';

export function llmTransport(event: Pick<RequestEvent, 'platform'>, settings: LlmSettings) {
	return createLlmTransport(settings.endpoint, !!event.platform?.env);
}
async function llmEncryptionSecret(event: Pick<RequestEvent, 'platform'>): Promise<string> {
	if (!event.platform?.env && env.STORAGE_PATH) {
		const { loadManagedLlmSecret } = await import('./llmSecret');
		return loadManagedLlmSecret(env.STORAGE_PATH, env.LLM_CONFIG_ENCRYPTION_KEY, async () =>
			(await getLlmStore(event)).hasEncryptedCredentials()
		);
	}
	// Worker deployments keep their existing server-side secret; they have no persistent filesystem.
	return validateLlmSecret(env.LLM_CONFIG_ENCRYPTION_KEY ?? '');
}
export async function loadActivitySnapshot(event: Pick<RequestEvent, 'platform'>) {
	const row = await (await getLlmStore(event)).active();
	if (!row || !row.settings.enabled) throw new LlmError('ai_unavailable', 503);
	const settings = Object.freeze({ ...validateLlmSettings(row.settings) });
	const key = row.encryptedKey
		? await decryptLlmKey(row.encryptedKey, row.configuration.id, await llmEncryptionSecret(event))
		: undefined;
	if (llmCapabilities(settings.provider, settings.model).keyRequired && !key)
		throw new LlmError('credential_required');
	return {
		id: row.configuration.id,
		version: row.configuration.version,
		settings,
		provider: createLlmProvider(settings, key, llmTransport(event, settings))
	};
}
export async function activityAvailable(event: Pick<RequestEvent, 'platform'>) {
	try {
		await loadActivitySnapshot(event);
		return true;
	} catch {
		return false;
	}
}
export async function resolveLlmCredential(
	event: Pick<RequestEvent, 'platform'>,
	id: string,
	settings: LlmSettings,
	credential: unknown,
	previous?: StoredLlm,
	saving = false
) {
	if (!credential || typeof credential !== 'object')
		throw new LlmError('invalid_configuration', 400, 'credential');
	const value = credential as Record<string, unknown>;
	if (!['keep', 'replace', 'remove'].includes(String(value.action)))
		throw new LlmError('invalid_configuration', 400, 'credential');
	const changedDestination =
		previous &&
		(settings.provider !== previous.settings.provider ||
			settings.endpoint !== previous.settings.endpoint);
	if (value.action === 'keep' && changedDestination && previous.encryptedKey)
		throw new LlmError('credential_destination_changed');
	let key: string | undefined;
	let encryptedKey: string | null = null;
	if (previous?.encryptedKey) {
		try {
			key = await decryptLlmKey(previous.encryptedKey, id, await llmEncryptionSecret(event));
		} catch (cause) {
			// Allow administrators to disable an unreadable configuration without touching its ciphertext.
			if (saving && value.action === 'keep' && !settings.enabled && !changedDestination)
				return { key: undefined, encryptedKey: previous.encryptedKey, action: 'keep' };
			throw cause;
		}
	}
	if (value.action === 'keep') encryptedKey = previous?.encryptedKey ?? null;
	if (value.action === 'remove') key = undefined;
	if (value.action === 'replace') {
		if (
			typeof value.value !== 'string' ||
			!value.value.trim() ||
			new TextEncoder().encode(value.value).length > 8192 ||
			[...value.value].some((char) => [0, 10, 13].includes(char.charCodeAt(0)))
		)
			throw new LlmError('invalid_configuration', 400, 'credential');
		key = value.value;
		encryptedKey = await encryptLlmKey(key, id, await llmEncryptionSecret(event));
	}
	if (
		llmCapabilities(settings.provider, settings.model).keyRequired &&
		!key &&
		(settings.enabled || !saving)
	)
		throw new LlmError('credential_required');
	return { key, encryptedKey, action: String(value.action) };
}
function legacySettings(): LlmSettings {
	if (
		!env.LLM_BASE_URL ||
		!env.LLM_MODEL ||
		(env.LLM_PROVIDER && env.LLM_PROVIDER !== 'openai-compatible')
	)
		throw new LlmError('legacy_unavailable');
	const number = (name: string, fallback: number) => (env[name] ? Number(env[name]) : fallback);
	const settings = validateLlmSettings({
		name: 'Imported LLM',
		provider: 'custom',
		endpoint: env.LLM_BASE_URL,
		model: env.LLM_MODEL,
		enabled: env.LLM_ENABLED?.toLowerCase() !== 'false',
		temperature: number('LLM_TEMPERATURE', 0.7),
		topP: number('LLM_TOP_P', 0.95),
		maxOutputTokens: number('LLM_MAX_OUTPUT_TOKENS', 2048),
		requestTimeoutSeconds: number('LLM_TIMEOUT_MS', 240000) / 1000,
		generationTimeoutSeconds: number('LLM_GENERATION_TIMEOUT_MS', 900000) / 1000,
		batchSize: number('LLM_BATCH_SIZE', 3),
		maxConcurrentOperations: llmDefaults.maxConcurrentOperations
	});
	return settings;
}
export function legacyLlmPreview() {
	try {
		return { available: true, settings: legacySettings(), hasApiKey: !!env.LLM_API_KEY };
	} catch {
		return { available: false, settings: null, hasApiKey: false };
	}
}
export async function importLegacyLlm(event: RequestEvent, actor: NonNullable<App.Locals['user']>) {
	const settings = legacySettings();
	validateLlmEndpoint(settings.endpoint);
	const id = crypto.randomUUID();
	const encrypted = env.LLM_API_KEY
		? await encryptLlmKey(env.LLM_API_KEY, id, await llmEncryptionSecret(event))
		: null;
	return (await getLlmStore(event)).save(
		actor,
		id,
		null,
		settings,
		encrypted,
		encrypted ? 'replace' : 'remove',
		true
	);
}
