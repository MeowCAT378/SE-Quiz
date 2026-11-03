export const llmProviders = ['ollama', 'vllm', 'openai', 'gemini', 'claude', 'custom'] as const;
export type LlmProvider = (typeof llmProviders)[number];
export type LlmSettings = {
	name: string;
	provider: LlmProvider;
	endpoint: string;
	model: string;
	enabled: boolean;
	temperature: number | null;
	topP: number | null;
	maxOutputTokens: number;
	requestTimeoutSeconds: number;
	generationTimeoutSeconds: number;
	batchSize: number;
	maxConcurrentOperations: number;
};
export type LlmConfiguration = LlmSettings & {
	id: string;
	version: number;
	hasApiKey: boolean;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
	updatedBy: string;
};
export type LlmSelection = { activeId: string | null; version: number };
export type LlmList = {
	configurations: LlmConfiguration[];
	selection: LlmSelection;
	established: boolean;
};
export const llmDefaults = Object.freeze({
	temperature: 0.5,
	topP: 0.95,
	maxOutputTokens: 4096,
	requestTimeoutSeconds: 240,
	generationTimeoutSeconds: 900,
	batchSize: 3,
	maxConcurrentOperations: 2
});
export class LlmError extends Error {
	constructor(
		public code: string,
		public status = 400,
		public field?: string
	) {
		super(code);
	}
}
export function llmCapabilities(provider: LlmProvider, model: string) {
	// Unknown models remain testable; this is a documented restriction table, not a model picker.
	const claudeFixed =
		provider === 'claude' &&
		/(?:mythos|fable|(?:opus|sonnet|haiku)-(?:[5-9]|4-[7-9]))/i.test(model);
	const openaiFixed = provider === 'openai' && /^(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/i.test(model);
	return {
		protocol:
			provider === 'gemini' ? 'gemini' : provider === 'claude' ? 'anthropic' : 'openai-compatible',
		sampling: !claudeFixed && !openaiFixed,
		maxTemperature: provider === 'claude' ? 1 : 2,
		keyRequired: ['openai', 'gemini', 'claude'].includes(provider),
		exclusiveSampling: provider === 'claude',
		tokenParameter: provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'
	} as const;
}
export function resetLlmParameters<T extends LlmSettings>(settings: T): T {
	const capabilities = llmCapabilities(settings.provider, settings.model);
	return {
		...settings,
		...llmDefaults,
		temperature: capabilities.sampling ? llmDefaults.temperature : null,
		topP: capabilities.sampling && !capabilities.exclusiveSampling ? llmDefaults.topP : null
	};
}
export function defaultLlmSettings(): LlmSettings {
	return { name: '', provider: 'ollama', endpoint: '', model: '', enabled: false, ...llmDefaults };
}
export function validateLlmSettings(input: unknown, discovery = false): LlmSettings {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw new LlmError('invalid_configuration');
	const value = input as Record<string, unknown>;
	const text = (field: string, maximum: number) => {
		const raw = value[field];
		if (
			typeof raw !== 'string' ||
			!raw.trim() ||
			raw.length > maximum ||
			[...raw].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
		)
			throw new LlmError('invalid_configuration', 400, field);
		return raw.trim();
	};
	const number = (field: string, min: number, max: number, integer = false, nullable = false) => {
		const raw = value[field];
		if (raw === null && nullable) return null;
		if (
			typeof raw !== 'number' ||
			!Number.isFinite(raw) ||
			raw < min ||
			raw > max ||
			(integer && !Number.isSafeInteger(raw))
		)
			throw new LlmError('invalid_configuration', 400, field);
		return raw;
	};
	if (!llmProviders.includes(value.provider as LlmProvider) || typeof value.enabled !== 'boolean')
		throw new LlmError('invalid_configuration');
	const provider = value.provider as LlmProvider;
	const model = discovery && value.model === '' ? '' : text('model', 256);
	const capabilities = llmCapabilities(provider, model);
	const temperature = number('temperature', 0, capabilities.maxTemperature, false, true);
	const topP = number('topP', 0.01, 1, false, true);
	if (
		(!capabilities.sampling && (temperature !== null || topP !== null)) ||
		(capabilities.exclusiveSampling && temperature !== null && topP !== null)
	)
		throw new LlmError('unsupported_option');
	const endpoint = text('endpoint', 2048);
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new LlmError('invalid_configuration', 400, 'endpoint');
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		/%2f|%5c/i.test(url.pathname)
	)
		throw new LlmError('invalid_configuration', 400, 'endpoint');
	return {
		name: text('name', 100),
		provider,
		model,
		endpoint: url.toString().replace(/\/$/, ''),
		enabled: value.enabled,
		temperature,
		topP,
		maxOutputTokens: number('maxOutputTokens', 128, 16384, true)!,
		requestTimeoutSeconds: number('requestTimeoutSeconds', 1, 900, true)!,
		generationTimeoutSeconds: number('generationTimeoutSeconds', 1, 1800, true)!,
		batchSize: number('batchSize', 1, 20, true)!,
		// Older saved configurations predate the configurable concurrency limit.
		maxConcurrentOperations:
			value.maxConcurrentOperations === undefined
				? llmDefaults.maxConcurrentOperations
				: number('maxConcurrentOperations', 1, Number.MAX_SAFE_INTEGER, true)!
	};
}
