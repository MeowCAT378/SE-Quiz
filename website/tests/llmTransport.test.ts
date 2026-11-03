import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: dns }));

import { createLlmTransport, LLM_RESPONSE_BYTES } from '../src/lib/server/llmTransport';

afterEach(() => vi.unstubAllGlobals());
it('pins the validated DNS result and refuses metadata, path escapes, redirects, oversized bodies and timeouts', async () => {
	let mode = 'ok',
		requests = 0;
	const server = createServer((_req, res) => {
		requests++;
		if (mode === 'redirect') {
			res.writeHead(302, { location: 'http://169.254.169.254/' });
			res.end();
		} else if (mode === 'large') res.end('x'.repeat(LLM_RESPONSE_BYTES + 1));
		else if (mode !== 'slow') res.end('{}');
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const endpoint = `http://fixture.invalid:${(server.address() as { port: number }).port}/v1`;
	const transport = createLlmTransport(endpoint, false);
	try {
		await expect(transport('../outside', {})).rejects.toMatchObject({
			code: 'destination_not_allowed'
		});
		expect(requests).toBe(0);
		dns.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
		expect((await transport('/models', {})).status).toBe(200);
		expect(dns).toHaveBeenCalledTimes(1); // The HTTP socket must not resolve fixture.invalid again.
		dns.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
		await expect(transport('/models', {})).rejects.toMatchObject({
			code: 'destination_not_allowed'
		});
		expect(requests).toBe(1);
		mode = 'redirect';
		await expect(transport('/models', {})).rejects.toMatchObject({
			code: 'destination_not_allowed'
		});
		expect(requests).toBe(2);
		mode = 'large';
		await expect(transport('/models', {})).rejects.toMatchObject({ code: 'invalid_response' });
		mode = 'slow';
		await expect(transport('/models', { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({
			code: 'request_timeout'
		});
		dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
		await expect(transport('/models', {})).rejects.toMatchObject({
			code: 'destination_not_allowed'
		});
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
it('permits private HTTPS for the exact ADMIN-managed endpoint', async () => {
	const node = await import('../src/lib/server/llmTransportNode');
	const pinned = vi.spyOn(node, 'pinnedLlmRequest').mockResolvedValue(new Response('{}'));
	try {
		await createLlmTransport('https://llm.internal:8443/v1', false)('/models', {});
		expect(pinned).toHaveBeenCalledWith(new URL('https://llm.internal:8443/v1/models'), {}, true);
	} finally {
		pinned.mockRestore();
	}
});
it('requires Worker HTTPS and disables redirects with bounded response reads', async () => {
	const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response('{}'));
	vi.stubGlobal('fetch', fetcher);
	const endpoint = 'https://fixture.example/v1';
	const transport = createLlmTransport(endpoint, true);
	await transport('/models', {});
	expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
	await expect(
		createLlmTransport('http://localhost/v1', true)('/models', {})
	).rejects.toMatchObject({ code: 'destination_not_allowed' });
	fetcher.mockResolvedValueOnce(new Response('x'.repeat(LLM_RESPONSE_BYTES + 1)));
	await expect(transport('/models', {})).rejects.toMatchObject({ code: 'invalid_response' });
});
