import { expect, it } from 'vitest';
import { GET } from '../src/routes/api/admin/llm/+server';
import { POST } from '../src/routes/api/admin/llm/[action]/+server';

it('guards all management actions before touching storage or a provider', async () => {
	for (const action of ['save', 'select', 'delete', 'test', 'models', 'import', 'audit']) {
		for (const role of [null, 'TEACHER', 'ADMIN']) {
			for (const origin of ['http://localhost', 'https://attacker.test']) {
				if (role === 'ADMIN' && origin === 'http://localhost') continue;
				const event = {
					params: { action },
					request: new Request(`http://localhost/api/admin/llm/${action}`, {
						method: 'POST',
						headers: { origin },
						body: '{}'
					}),
					url: new URL('http://localhost'),
					locals: {
						user: role ? { id: 'user', role } : null,
						session: role ? { issuedAt: 1 } : null
					}
				} as any;
				expect((await POST(event)).status).toBe(role ? 403 : 401);
			}
		}
	}
	const anonymous = {
		locals: {},
		request: new Request('http://localhost/api/admin/llm'),
		url: new URL('http://localhost')
	} as any;
	expect((await GET(anonymous)).status).toBe(401);
});
