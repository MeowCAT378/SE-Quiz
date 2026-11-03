import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { base } from '$app/paths';
import { env } from '$env/dynamic/private';

// Historical cookie name shared by both roles; role and revocation come from the account store.
const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function sign(payload: string): string {
	if (!env.ADMIN_SESSION_SECRET) throw new Error('ADMIN_SESSION_SECRET is required');
	return createHmac('sha256', env.ADMIN_SESSION_SECRET).update(payload).digest('hex');
}

export type SessionIdentity = {
	userId: string;
	sessionVersion: number;
	issuedAt: number;
	expiresAt: number;
};
export function createSessionToken(account: { id: string; sessionVersion: number }): string {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.id) ||
		!Number.isSafeInteger(account.sessionVersion) ||
		account.sessionVersion < 0
	)
		throw new Error('Invalid session identity');
	const payload = `user-session-v1.${account.id}.${account.sessionVersion}.${Date.now()}`;
	return `${payload}.${sign(payload)}`;
}
export function verifySessionToken(
	token: string
): ({ valid: true } & SessionIdentity) | { valid: false } {
	if (!token || !env.ADMIN_SESSION_SECRET || token.length > 256) return { valid: false };
	const parts = token.split('.');
	if (parts.length !== 5) return { valid: false };
	const [purpose, userId, version, timestamp, signature] = parts;
	if (
		purpose !== 'user-session-v1' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
		!/^(0|[1-9]\d*)$/.test(version) ||
		!/^\d+$/.test(timestamp) ||
		!/^[a-f0-9]{64}$/.test(signature)
	)
		return { valid: false };
	if (
		!timingSafeEqual(
			Buffer.from(signature, 'hex'),
			Buffer.from(sign(parts.slice(0, 4).join('.')), 'hex')
		)
	)
		return { valid: false };
	const issuedAt = Number(timestamp);
	const sessionVersion = Number(version);
	const expiresAt = issuedAt + SESSION_MAX_AGE * 1000;
	if (
		!Number.isSafeInteger(issuedAt) ||
		!Number.isSafeInteger(sessionVersion) ||
		issuedAt > Date.now() + 60000 ||
		expiresAt <= Date.now()
	)
		return { valid: false };
	return { valid: true, userId, sessionVersion, issuedAt, expiresAt };
}
export function safeReturnPath(path: string | null | undefined): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: reject URL-parser control-character bypasses
	if (!path?.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path))
		return `${base}/`;
	const url = new URL(path, 'http://return.invalid');
	if (url.pathname.startsWith('//')) return `${base}/`;
	if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return `${base}/`;
	return url.pathname + url.search + url.hash;
}

export function setAdminSession(
	cookies: Cookies,
	account: { id: string; sessionVersion: number },
	url: URL
): void {
	cookies.set(SESSION_COOKIE_NAME, createSessionToken(account), {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax',
		maxAge: SESSION_MAX_AGE
	});
}

export function clearAdminSession(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}
