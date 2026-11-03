import { expect, it } from 'vitest';
import { routePolicy } from '../src/lib/server/authPolicy';

it('protects private page descendants and data requests without blocking players', () => {
	for (const path of ['/create', '/host/123', '/quiz/4/edit', '/reports/4', '/publish'])
		expect(routePolicy(path, 'GET')).toBe('user');
	expect(routePolicy('/api/quiz/published', 'GET')).toBe('user');
	for (const path of ['/play', '/play/123', '/share/abc', '/library', '/api/games/active'])
		expect(routePolicy(path, 'GET')).toBe('public');
});
it('protects both ADMIN aliases and cookie authenticated API mutations', () => {
	expect(routePolicy('/admin/users', 'GET')).toBe('admin');
	expect(routePolicy('/admin-api/games/active', 'GET')).toBe('admin');
	expect(routePolicy('/api/admin/users', 'POST')).toBe('admin');
	expect(routePolicy('/api/games/active', 'POST')).toBe('user');
	expect(routePolicy('/api/gdrive/callback', 'GET')).toBe('user');
	expect(routePolicy('/api/host/authorize', 'POST')).toBe('public');
	expect(routePolicy('/admin/login', 'POST')).toBe('public');
});
