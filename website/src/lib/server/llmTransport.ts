import { AIProviderError, providerAbortError } from '../ai/base';
import { LlmError } from '../ai/llmConfiguration';
import { validateLlmEndpoint } from './llmDestinations';

export type LlmTransport = (path: string, init: RequestInit) => Promise<Response>;
export const LLM_RESPONSE_BYTES = 1024 * 1024;
// Only ADMIN-managed settings may supply the endpoint, including local/private services.
export function createLlmTransport(endpoint: string, worker: boolean): LlmTransport {
	const base = validateLlmEndpoint(endpoint);
	return async (path, init) => {
		const url = new URL(`${endpoint.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
		if (
			url.origin !== base.origin ||
			!url.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`) ||
			url.search ||
			url.hash
		)
			throw new LlmError('destination_not_allowed');
		try {
			if (init.signal?.aborted) throw providerAbortError(init.signal);
			if (!worker) {
				const { pinnedLlmRequest } = await import('./llmTransportNode');
				return await pinnedLlmRequest(url, init, true);
			}
			// Worker fetch cannot reach the deployment host's loopback/LAN. Use an approved HTTPS gateway.
			if (
				url.protocol !== 'https:' ||
				/^(?:localhost|host\.docker\.internal|\[|\d+\.)/.test(url.hostname)
			)
				throw new LlmError('destination_not_allowed');
			const response = await fetch(url, { ...init, redirect: 'error' });
			const reader = response.body?.getReader();
			const parts: Uint8Array[] = [];
			let length = 0;
			if (reader)
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						length += value.length;
						if (length > LLM_RESPONSE_BYTES) {
							await reader.cancel();
							throw new AIProviderError('invalid_response');
						}
						parts.push(value);
					}
				} finally {
					reader.releaseLock();
				}
			const body = new Uint8Array(length);
			let offset = 0;
			for (const part of parts) {
				body.set(part, offset);
				offset += part.length;
			}
			return new Response([204, 205, 304].includes(response.status) ? null : body, {
				status: response.status
			});
		} catch (cause) {
			if (init.signal?.aborted) throw providerAbortError(init.signal);
			if (cause instanceof AIProviderError || cause instanceof LlmError) throw cause;
			throw new AIProviderError('provider_unavailable');
		}
	};
}
