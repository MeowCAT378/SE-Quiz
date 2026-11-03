import { describe, expect, it } from 'vitest';
import { POST } from '../src/routes/api/admin/users/+server';

describe('server-only ADMIN account management', () => {
	it.each([
		null,
		'TEACHER'
	])('rejects account creation and manipulated roles for %s', async (role) => {
		const url = new URL('http://localhost/api/admin/users');
		const event = {
			url,
			request: new Request(url, {
				method: 'POST',
				headers: { origin: url.origin },
				body: '{"role":"ADMIN"}'
			}),
			locals: {
				user: role ? { id: 'teacher', role, sessionVersion: 0 } : null,
				session: role ? { issuedAt: Date.now(), expiresAt: Date.now() + 1000 } : null
			}
		};
		await expect(POST(event as never)).rejects.toMatchObject({ status: role ? 403 : 401 });
	});
});
