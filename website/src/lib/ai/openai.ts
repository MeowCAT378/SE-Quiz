/**
 * OpenAI-compatible API implementation
 * Works with OpenAI, OpenRouter, Ollama, LiteLLM, and any provider
 * that implements the OpenAI chat completions API
 */

import {
	AIProviderError,
	BaseAI,
	providerAbortError,
	providerHttpError,
	type StructuredGenerationRequest,
	type StructuredGenerationResult
} from './base';
import { LlmError } from './llmConfiguration';

export class OpenAICompatibleAI extends BaseAI {
	private baseUrl: string;
	private apiKey: string | undefined;
	private model: string;
	private maxOutputTokens: number;
	private temperature: number | null;
	private topP: number | null;
	private structuredFetch: typeof fetch;
	private tokenParameter: string;

	constructor(
		baseUrl: string,
		apiKey: string | undefined,
		model: string,
		options: {
			maxOutputTokens?: number;
			temperature?: number | null;
			topP?: number | null;
			fetch?: typeof fetch;
			tokenParameter?: string;
		} = {}
	) {
		super();
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.apiKey = apiKey;
		this.model = model;
		this.maxOutputTokens = options.maxOutputTokens ?? 2048;
		this.temperature = options.temperature === undefined ? 0.7 : options.temperature;
		this.topP = options.topP === undefined ? 0.95 : options.topP;
		this.structuredFetch = options.fetch ?? fetch;
		this.tokenParameter = options.tokenParameter ?? 'max_tokens';
	}

	async generateKeywords(systemPrompt: string, userContent: string): Promise<string | null> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		}

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: this.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userContent }
				],
				response_format: { type: 'json_object' }
			})
		});

		if (!response.ok) {
			console.error('AI request failed:', response.status);
			return null;
		}

		const data = await response.json();
		return data.choices?.[0]?.message?.content || null;
	}

	async generateStructured(
		request: StructuredGenerationRequest
	): Promise<StructuredGenerationResult> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

		let response: Response;
		try {
			response = await this.structuredFetch(`${this.baseUrl}/chat/completions`, {
				method: 'POST',
				headers,
				signal: request.signal,
				body: JSON.stringify({
					model: this.model,
					messages: [
						{ role: 'system', content: request.systemPrompt },
						{ role: 'user', content: request.userContent }
					],
					response_format: {
						type: 'json_schema',
						json_schema: {
							name: 'activity_items',
							strict: true,
							schema: request.schema
						}
					},
					stream: false,
					[this.tokenParameter]: this.maxOutputTokens,
					...(this.temperature === null ? {} : { temperature: this.temperature }),
					...(this.topP === null ? {} : { top_p: this.topP })
				})
			});
		} catch (cause) {
			if (
				request.signal?.aborted ||
				(cause instanceof DOMException && cause.name === 'AbortError')
			) {
				throw providerAbortError(request.signal);
			}
			if (cause instanceof AIProviderError || cause instanceof LlmError) throw cause;
			throw new AIProviderError('provider_unavailable');
		}

		if (!response.ok) {
			// Expose classified failures only; provider bodies can contain prompts or credentials.
			throw providerHttpError(response.status);
		}

		let data: any;
		try {
			data = await response.json();
		} catch {
			throw new AIProviderError('invalid_response');
		}
		const choice = data?.choices?.[0];
		if (choice?.message?.tool_calls?.length || choice?.finish_reason === 'tool_calls') {
			throw new AIProviderError('unexpected_tool_call');
		}
		if (choice?.finish_reason === 'length') throw new AIProviderError('truncated_response');
		if (choice?.finish_reason !== 'stop' || choice?.message?.refusal)
			throw new AIProviderError('invalid_response');
		const content = choice?.message?.content;
		if (typeof content !== 'string' || !content.trim()) throw new AIProviderError('empty_response');
		const trimmed = content.trim();
		if (trimmed.startsWith('```') || trimmed.includes('<think>') || trimmed.includes('</think>')) {
			throw new AIProviderError('invalid_response');
		}
		return {
			content: trimmed,
			finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
			usage: data.usage
				? {
						promptTokens:
							Number.isSafeInteger(data.usage.prompt_tokens) && data.usage.prompt_tokens >= 0
								? data.usage.prompt_tokens
								: undefined,
						completionTokens:
							Number.isSafeInteger(data.usage.completion_tokens) &&
							data.usage.completion_tokens >= 0
								? data.usage.completion_tokens
								: undefined
					}
				: undefined
		};
	}
}
