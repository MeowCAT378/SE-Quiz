import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import { AIProviderError, providerAbortError } from '../ai/base';
import { LlmError } from '../ai/llmConfiguration';
import { isForbiddenAddress, isPrivateAddress } from './llmDestinations';
import { LLM_RESPONSE_BYTES } from './llmTransport';

export async function pinnedLlmRequest(
	url: URL,
	init: RequestInit,
	allowPrivate: boolean
): Promise<Response> {
	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	const resolving = isIP(hostname)
		? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
		: lookup(hostname, { all: true });
	const addresses = await new Promise<Awaited<typeof resolving>>((resolve, reject) => {
		const abort = () => reject(providerAbortError(init.signal));
		if (init.signal?.aborted) {
			abort();
			return;
		}
		init.signal?.addEventListener('abort', abort, { once: true });
		void resolving
			.then(resolve, reject)
			.finally(() => init.signal?.removeEventListener('abort', abort));
	});
	if (
		!addresses.length ||
		addresses.some(
			({ address }) => isForbiddenAddress(address) || (!allowPrivate && isPrivateAddress(address))
		)
	)
		throw new LlmError('destination_not_allowed');
	if (
		url.protocol === 'http:' &&
		(!allowPrivate || addresses.some(({ address }) => !isPrivateAddress(address)))
	)
		throw new LlmError('destination_not_allowed');
	if (init.signal?.aborted) throw providerAbortError(init.signal);
	const chosen = addresses[0];
	return new Promise((resolve, reject) => {
		const options = {
			method: init.method ?? 'GET',
			headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.host },
			signal: init.signal ?? undefined,
			agent: false as const,
			// Pin the socket numerically on both Bun and Node, retaining the original HTTP and TLS identity.
			hostname: chosen.address,
			family: chosen.family,
			servername: hostname,
			checkServerIdentity: (_host: string, cert: PeerCertificate) =>
				checkServerIdentity(hostname, cert)
		};
		const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, (res) => {
			const status = res.statusCode ?? 502;
			if (status >= 300 && status < 400) {
				res.destroy();
				reject(new LlmError('destination_not_allowed'));
				return;
			}
			const chunks: Buffer[] = [];
			let length = 0;
			res.on('data', (chunk: Buffer) => {
				length += chunk.length;
				if (length > LLM_RESPONSE_BYTES) {
					res.destroy();
					reject(new AIProviderError('invalid_response'));
				} else chunks.push(chunk);
			});
			res.on('error', reject);
			res.on('end', () =>
				resolve(
					new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status })
				)
			);
		});
		req.on('error', reject);
		if (init.body) req.write(init.body);
		req.end();
	});
}
