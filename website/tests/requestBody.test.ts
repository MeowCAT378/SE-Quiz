import { describe, expect, it } from 'vitest';
import * as body from '../src/lib/server/requestBody';

describe('finite protected request bodies', () => {
	it('rejects oversized streams without trusting Content-Length', async () => {
		const request = new Request('http://localhost', { method: 'POST', body: '12345' });
		await expect(body.readTextBody(request, 4)).rejects.toMatchObject({ status: 413 });
	});
	it('returns parsed objects and rejects malformed JSON', async () => {
		await expect(
			body.readJsonBody(
				new Request('http://localhost', { method: 'POST', body: '{"email":"user@example.test"}' })
			)
		).resolves.toEqual({ email: 'user@example.test' });
		await expect(
			body.readJsonBody(new Request('http://localhost', { method: 'POST', body: '{' }))
		).rejects.toMatchObject({ status: 400 });
	});
});
