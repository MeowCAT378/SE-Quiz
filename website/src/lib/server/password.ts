import { timingSafeEqual } from 'node:crypto';

const ITERATIONS = 600000;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Buffer> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	return Buffer.from(
		await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
			key,
			256
		)
	);
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await derive(password, salt);
	return `pbkdf2-sha256$${ITERATIONS}$${Buffer.from(salt).toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	const parts = hash.split('$');
	if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== String(ITERATIONS))
		return false;
	if (!/^[A-Za-z0-9_-]{22}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) return false;
	const salt = Uint8Array.from(Buffer.from(parts[2], 'base64url'));
	const expected = Buffer.from(parts[3], 'base64url');
	const actual = await derive(password, salt);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}
