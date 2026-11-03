import { expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/server/password';

it('salts password hashes and rejects wrong passwords or malformed stored hashes', async () => {
	const password = 'test-only-password';
	const hash = await hashPassword(password);
	expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[\w-]{22}\$[\w-]{43}$/);
	expect(await hashPassword(password)).not.toBe(hash);
	expect(await verifyPassword(password, hash)).toBe(true);
	expect(await verifyPassword('wrong', hash)).toBe(false);
	expect(await verifyPassword(password, 'broken')).toBe(false);
	expect(await verifyPassword(password, hash.replace('$600000$', '$1$'))).toBe(false);
});
