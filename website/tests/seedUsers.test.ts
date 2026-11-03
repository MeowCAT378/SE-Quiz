import type { SQL } from 'bun';
import { expect, it, vi } from 'vitest';
import { verifyPassword } from '../src/lib/server/password';
import { seedDevelopmentUsers, seedUsers } from '../src/lib/server/seedUsers';

it('preserves an existing administrator and inserts the teacher with a hashed password', async () => {
	const tx = vi.fn(async (query: TemplateStringsArray, ...values: unknown[]) => {
		if (query.join('').startsWith('SELECT') && values[0] === 'admin@admin.com')
			return [{ role: 'ADMIN', deleted_at: null }];
		return [];
	});
	const sql = { begin: (work: (tx: unknown) => Promise<unknown>) => work(tx) } as unknown as SQL;
	expect(await seedDevelopmentUsers(sql)).toEqual({ created: 1, total: 2 });
	const inserts = tx.mock.calls.filter(([query]) => query.join('').startsWith('INSERT'));
	expect(inserts).toHaveLength(1);
	const [, id, email, hash, role] = inserts[0];
	expect(id).toMatch(/^[\da-f-]{36}$/);
	expect(email).toBe('test@test.com');
	expect(role).toBe('TEACHER');
	expect(hash).not.toBe(seedUsers[1].password);
	expect(await verifyPassword(seedUsers[1].password, hash as string)).toBe(true);
});

it.each([
	{ role: 'TEACHER', deleted_at: null },
	{ role: 'ADMIN', deleted_at: new Date() }
])('refuses a reserved administrator email instead of changing its account', async (existing) => {
	const tx = vi.fn(async (query: TemplateStringsArray) =>
		query.join('').startsWith('SELECT') ? [existing] : []
	);
	const sql = { begin: (work: (tx: unknown) => Promise<unknown>) => work(tx) } as unknown as SQL;
	await expect(seedDevelopmentUsers(sql)).rejects.toThrow(/reserved/);
	expect(tx.mock.calls.some(([query]) => query.join('').startsWith('INSERT'))).toBe(false);
});
