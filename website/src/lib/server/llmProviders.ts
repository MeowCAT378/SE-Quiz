import {
	AIProviderError,
	type BaseAI,
	type JsonSchema,
	providerHttpError,
	type StructuredGenerationRequest
} from '../ai/base';
import { type LlmSettings, llmCapabilities } from '../ai/llmConfiguration';
import { OpenAICompatibleAI } from '../ai/openai';
import type { LlmTransport } from './llmTransport';

function providerSchema(schema: JsonSchema, claude: boolean): JsonSchema {
	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk);
		if (!value || typeof value !== 'object') return value;
		const result: Record<string, unknown> = {};
		const constraints: string[] = [];
		for (const [key, item] of Object.entries(value)) {
			if (
				['minLength', 'maxLength', 'exclusiveMinimum'].includes(key) ||
				(claude && ['minimum', 'maximum', 'minItems', 'maxItems'].includes(key))
			)
				constraints.push(`${key}: ${item}`);
			else result[key] = walk(item);
		}
		if (constraints.length)
			result.description = [result.description, ...constraints].filter(Boolean).join('; ');
		return result;
	};
	// Provider grammars use a subset; activityGeneration still validates every original constraint.
	return walk(schema) as JsonSchema;
}
export function llmHeaders(settings: LlmSettings, key?: string): Record<string, string> {
	return {
		'content-type': 'application/json',
		...(settings.provider === 'claude' ? { 'anthropic-version': '2023-06-01' } : {}),
		...(key
			? settings.provider === 'claude'
				? { 'x-api-key': key }
				: settings.provider === 'gemini'
					? { 'x-goog-api-key': key }
					: { authorization: `Bearer ${key}` }
			: {})
	};
}
export function createLlmProvider(
	settings: LlmSettings,
	key: string | undefined,
	transport: LlmTransport
): Pick<BaseAI, 'generateStructured'> {
	const capability = llmCapabilities(settings.provider, settings.model);
	if (capability.protocol === 'openai-compatible')
		return new OpenAICompatibleAI(settings.endpoint, key, settings.model, {
			maxOutputTokens: settings.maxOutputTokens,
			temperature: settings.temperature,
			topP: settings.topP,
			tokenParameter: capability.tokenParameter,
			fetch: ((_url: unknown, init: RequestInit) =>
				transport('/chat/completions', init)) as typeof fetch
		});
	return {
		async generateStructured(request: StructuredGenerationRequest) {
			const claude = capability.protocol === 'anthropic';
			const sampling = {
				...(settings.temperature === null ? {} : { temperature: settings.temperature }),
				...(settings.topP === null ? {} : { [claude ? 'top_p' : 'topP']: settings.topP })
			};
			const body = claude
				? {
						model: settings.model,
						system: request.systemPrompt,
						messages: [{ role: 'user', content: request.userContent }],
						max_tokens: settings.maxOutputTokens,
						stream: false,
						...sampling,
						output_config: {
							format: { type: 'json_schema', schema: providerSchema(request.schema, true) }
						}
					}
				: {
						systemInstruction: { parts: [{ text: request.systemPrompt }] },
						contents: [{ role: 'user', parts: [{ text: request.userContent }] }],
						generationConfig: {
							...sampling,
							maxOutputTokens: settings.maxOutputTokens,
							responseMimeType: 'application/json',
							responseJsonSchema: providerSchema(request.schema, false)
						}
					};
			const response = await transport(
				claude
					? '/messages'
					: `/models/${encodeURIComponent(settings.model.replace(/^models\//, ''))}:generateContent`,
				{
					method: 'POST',
					headers: llmHeaders(settings, key),
					body: JSON.stringify(body),
					signal: request.signal
				}
			);
			if (!response.ok) throw providerHttpError(response.status);
			let data: Record<string, any>;
			try {
				data = await response.json();
			} catch {
				throw new AIProviderError('invalid_response');
			}
			if (!data || typeof data !== 'object') throw new AIProviderError('invalid_response');
			const finish = claude ? data.stop_reason : data.candidates?.[0]?.finishReason;
			if (finish === 'max_tokens' || finish === 'MAX_TOKENS')
				throw new AIProviderError('truncated_response');
			if (finish !== (claude ? 'end_turn' : 'STOP')) throw new AIProviderError('invalid_response');
			const parts = claude ? data.content : data.candidates?.[0]?.content?.parts;
			if (
				!Array.isArray(parts) ||
				parts.some(
					(part) =>
						!part || typeof part !== 'object' || part.type === 'tool_use' || part.functionCall
				)
			)
				throw new AIProviderError('unexpected_tool_call');
			const content = parts
				.filter((part) =>
					claude
						? part.type === 'text' && typeof part.text === 'string'
						: !part.thought && typeof part.text === 'string'
				)
				.map((part) => part.text)
				.join('')
				.trim();
			if (!content) throw new AIProviderError('empty_response');
			if (content.startsWith('```') || /<\/?think>/.test(content))
				throw new AIProviderError('invalid_response');
			return { content, finishReason: finish };
		}
	};
}
export async function discoverLlmModels(
	settings: LlmSettings,
	key: string | undefined,
	transport: LlmTransport,
	signal: AbortSignal
): Promise<string[]> {
	const response = await transport('/models', { headers: llmHeaders(settings, key), signal });
	if (!response.ok) throw providerHttpError(response.status);
	let data: Record<string, any>;
	try {
		data = await response.json();
	} catch {
		throw new AIProviderError('invalid_response');
	}
	if (!data || typeof data !== 'object') throw new AIProviderError('invalid_response');
	const rows = settings.provider === 'gemini' ? data.models : data.data;
	if (!Array.isArray(rows)) throw new AIProviderError('invalid_response');
	return [
		...new Set<string>(
			rows
				.filter((row) => row && typeof row === 'object')
				.map((row) =>
					settings.provider === 'gemini'
						? typeof row.name === 'string'
							? row.name.replace(/^models\//, '')
							: undefined
						: row.id
				)
				.filter((id) => typeof id === 'string' && id.length <= 256)
		)
	].slice(0, 100);
}
