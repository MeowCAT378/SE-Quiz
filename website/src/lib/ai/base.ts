/**
 * Base AI abstract class
 * Provides a simple interface for text generation with structured output
 */

export abstract class BaseAI {
	abstract generateKeywords(systemPrompt: string, userContent: string): Promise<string | null>;

	async generateStructured(
		_request: StructuredGenerationRequest
	): Promise<StructuredGenerationResult> {
		throw new AIProviderError('unsupported_option');
	}
}

export type JsonSchema = Record<string, unknown>;

export type StructuredGenerationRequest = {
	systemPrompt: string;
	userContent: string;
	schema: JsonSchema;
	signal?: AbortSignal;
};

export type StructuredGenerationResult = {
	content: string;
	finishReason?: string;
	usage?: { promptTokens?: number; completionTokens?: number };
};

export type AIProviderErrorCode =
	| 'model_unavailable'
	| 'rate_limited'
	| 'request_timeout'
	| 'generation_timeout'
	| 'authentication_failed'
	| 'provider_unavailable'
	| 'provider_error'
	| 'unsupported_option'
	| 'invalid_response'
	| 'empty_response'
	| 'unexpected_tool_call'
	| 'truncated_response'
	| 'cancelled';

export class AIProviderError extends Error {
	constructor(
		public code: AIProviderErrorCode,
		public status?: number
	) {
		super(code);
		this.name = 'AIProviderError';
	}
}

export function providerHttpError(status: number): AIProviderError {
	return new AIProviderError(
		status === 401 || status === 403
			? 'authentication_failed'
			: status === 404
				? 'model_unavailable'
				: status === 429
					? 'rate_limited'
					: status === 400 || status === 422
						? 'unsupported_option'
						: 'provider_error',
		status
	);
}
export function providerAbortError(signal?: AbortSignal | null): AIProviderError {
	if (signal?.reason instanceof AIProviderError) return signal.reason;
	return new AIProviderError(
		signal?.reason?.name === 'TimeoutError' ? 'request_timeout' : 'cancelled'
	);
}
