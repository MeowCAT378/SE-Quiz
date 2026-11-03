import { afterEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('$env/dynamic/private', () => ({ env }));

import { load } from '../src/routes/[[lang=locale]]/admin/login/+page.server';

afterEach(() => {
	for (const key of Object.keys(env)) delete env[key];
});

it.each([
	['d1', 'email'],
	['postgres', 'email']
])('uses the credential input constraint for %s', async (provider, expected) => {
	env.DB_PROVIDER = provider;
	const result = await load({
		locals: { isAdmin: false },
		url: new URL('http://localhost/admin/login')
	} as unknown as Parameters<typeof load>[0]);
	expect(result).toMatchObject({ credentialType: expected });
});
