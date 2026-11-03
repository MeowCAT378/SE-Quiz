import { afterEach, expect, it, vi } from 'vitest';

const { testBase } = vi.hoisted(() => ({ testBase: process.env.BASE_PATH || '/SEQuiz' }));
vi.mock('$app/paths', () => ({
	base: testBase,
	resolve: (path: string) => `${testBase}${path}`
}));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { safeReturnPath } from '../src/lib/server/auth';
import { routePolicy } from '../src/lib/server/authPolicy';
import { type AccountBinding, accountRequest } from '../src/lib/storage/account';
import { GET as sitemap } from '../src/routes/sitemap.xml/+server';

afterEach(() => vi.unstubAllGlobals());

it('generates sitemap links from the real route metadata below the application base', async () => {
	const response = await sitemap({
		url: new URL(`http://example.test${testBase}/sitemap.xml`)
	} as Parameters<typeof sitemap>[0]);
	expect(response.status).toBe(200);
	const text = await response.text();
	const urls = [...text.matchAll(/(?:<loc>|href=")([^<"]+)/g)].map((match) => match[1]);
	expect(urls.length).toBeGreaterThan(0);
	for (const url of urls) expect(new URL(url).pathname.startsWith(testBase + '/')).toBe(true);
});

it('applies the existing authorization policy below the application base', () => {
	for (const path of [
		'/create',
		'/quiz/1/edit',
		'/api/creations',
		'/api/host/games/123/authorization'
	])
		expect(routePolicy(`${testBase}${path}`, 'POST')).toBe('user');
	for (const path of ['/admin/users', '/admin-api/delete', '/api/admin/llm'])
		expect(routePolicy(`${testBase}${path}`, 'POST')).toBe('admin');
	expect(routePolicy(testBase + '/play', 'GET')).toBe('public');
});

it('keeps login and OAuth return URLs inside the exact application prefix', () => {
	expect(safeReturnPath(testBase + '/en/create?x=1#title')).toBe(testBase + '/en/create?x=1#title');
	for (const path of [
		null,
		'/',
		'/create',
		testBase + 'Other/create',
		testBase.toLowerCase() + '/create',
		testBase + '/../outside',
		testBase + '/%2e%2e/outside',
		'//elsewhere.test',
		'/\\elsewhere.test'
	])
		expect(safeReturnPath(path)).toBe(testBase + '/');
});

it('saves through the prefixed API while retaining account and session binding', async () => {
	const binding = {
		user: { id: '11111111-1111-4111-8111-111111111111' },
		sessionIssuedAt: 123,
		closed: false,
		close() {}
	} as AccountBinding;
	const requests: { url: string; init?: RequestInit }[] = [];
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		requests.push({ url, init });
		return Response.json(url.endsWith('/api/account') ? binding : { saved: true });
	});
	await accountRequest(binding, '/api/creations/id', { method: 'PUT', body: '{}' });
	expect(requests.map(({ url }) => url)).toEqual([
		testBase + '/api/account',
		testBase + '/api/creations/id',
		testBase + '/api/account'
	]);
	const headers = new Headers(requests[1].init?.headers);
	expect(headers.get('x-seopen-account')).toBe(binding.user.id);
	expect(headers.get('x-seopen-session')).toBe('123');
});
