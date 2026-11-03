import { beforeEach, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => ({
	forkRepository: vi.fn(async () => ({ forkId: 'fork', upstreamId: 'upstream' })),
	createBranch: vi.fn(async () => {}),
	createMultipleFiles: vi.fn(async () => {}),
	createPullRequest: vi.fn(async () => ({ url: 'https://example.test/pr' }))
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/git/factory', () => ({ createGitClient: () => git }));
vi.mock('../src/routes/api/git/gitUtil', () => ({
	getAuthenticatedProvider: () => 'gitlab',
	getTokens: () => ({ access_token: 'test' })
}));
vi.mock('$lib', () => ({
	stringifyToml: () => 'title = "test"',
	urlifyBase64: (config: unknown) => [config, []]
}));

import { POST } from '../src/routes/api/library/publish-init/+server';
import { GET } from '../src/routes/api/library/publish-stream/+server';

const fuiz = { config: { title: 'test', slides: [] }, author: 'teacher', language: 'en' };
const user = { id: 'owner', sessionVersion: 3, role: 'TEACHER' };
const job = { ownerId: user.id, sessionVersion: user.sessionVersion, fuiz };
const store = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
function event(method: string, headers: Record<string, string>, body?: string, identity = user) {
	const url = new URL('http://localhost/api/library/publish-stream?job=test-job');
	return {
		url,
		request: new Request(url, { method, headers, body }),
		locals: { user: identity, session: { expiresAt: Date.now() + 10000 }, publishJobsStore: store },
		cookies: {}
	} as never;
}
beforeEach(() => {
	vi.clearAllMocks();
	store.get.mockResolvedValue(job);
	store.put.mockResolvedValue(undefined);
	store.delete.mockResolvedValue(undefined);
});
it('binds initialized content to server-derived account and session version', async () => {
	const response = await POST(
		event(
			'POST',
			{ origin: 'http://localhost' },
			JSON.stringify({ fuiz, ownerId: 'attacker', sessionVersion: 999 })
		)
	);
	expect(response.status).toBe(200);
	expect(JSON.parse(store.put.mock.calls[0][1])).toEqual(job);
});
it.each([
	{ ...user, id: 'other' },
	{ ...user, sessionVersion: 4 }
])('denies a different owner or current session version before consumption', async (identity) => {
	const response = await GET(
		event('GET', { 'sec-fetch-site': 'same-origin' }, undefined, identity)
	);
	expect(response.status).toBe(404);
	expect(store.delete).not.toHaveBeenCalled();
	expect(git.forkRepository).not.toHaveBeenCalled();
});
it('rejects legacy jobs with no trusted owner binding', async () => {
	store.get.mockResolvedValueOnce(fuiz);
	expect((await GET(event('GET', { 'sec-fetch-site': 'same-origin' }))).status).toBe(404);
	expect(store.delete).not.toHaveBeenCalled();
});
it.each([
	{ origin: 'https://attacker.test' },
	{ 'sec-fetch-site': 'cross-site' },
	{ 'sec-fetch-site': 'same-site' },
	{}
] as Record<
	string,
	string
>[])('rejects unsafe stream initiation metadata %j before reads or mutation', async (headers) => {
	await expect(GET(event('GET', headers))).rejects.toMatchObject({ status: 403 });
	expect(store.get).not.toHaveBeenCalled();
	expect(store.delete).not.toHaveBeenCalled();
	expect(git.forkRepository).not.toHaveBeenCalled();
});
it.each([{ origin: 'http://localhost' }, { 'sec-fetch-site': 'same-origin' }] as Record<
	string,
	string
>[])('allows actual same-origin EventSource metadata %j', async (headers) => {
	const response = await GET(event('GET', headers));
	expect(response.status).toBe(200);
	expect(await response.text()).toContain('event: complete');
	expect(store.delete).toHaveBeenCalledWith('test-job');
});
it.each([
	['{', 400],
	['x'.repeat(4 * 1024 * 1024 + 1), 413]
] as const)('preserves bounded reader errors', async (body, status) => {
	await expect(POST(event('POST', { origin: 'http://localhost' }, body))).rejects.toMatchObject({
		status
	});
	expect(store.put).not.toHaveBeenCalled();
});
it('returns generic 503 without response or log leakage on provider failure', async () => {
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	store.put.mockRejectedValueOnce(new Error('sentinel-provider-secret'));
	const response = await POST(
		event('POST', { origin: 'http://localhost' }, JSON.stringify({ fuiz }))
	);
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain('sentinel-provider-secret');
	expect(log).not.toHaveBeenCalled();
	log.mockRestore();
});
