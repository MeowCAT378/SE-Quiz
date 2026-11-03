// Run: bun --env-file=../.env tests/auth.smoke.ts (against the running local stack).
// Credentials are read privately; this check never writes or logs them.
import assert from 'node:assert/strict';

const { ORIGIN, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD } = process.env;
assert(ORIGIN && ADMIN_SEED_EMAIL && ADMIN_SEED_PASSWORD, 'Private deployment settings required');
const login = new URL('/admin/login?returnTo=//example.test', ORIGIN);
const post = (email: string, password: string) =>
	fetch(login, {
		method: 'POST',
		redirect: 'manual',
		headers: { origin: ORIGIN, accept: 'text/html' },
		body: new URLSearchParams({ email, password })
	});
assert.equal((await fetch(ORIGIN)).status, 200);
assert.equal((await post(ADMIN_SEED_EMAIL, 'deliberately-wrong')).status, 401);
const response = await post(' ' + ADMIN_SEED_EMAIL.toUpperCase() + ' ', ADMIN_SEED_PASSWORD);
assert.equal(response.status, 303);
assert.equal(response.headers.get('location'), '/');
const cookieHeader = response.headers.get('set-cookie');
assert(cookieHeader);
assert(cookieHeader.includes('HttpOnly'));
assert(cookieHeader.includes('SameSite=Lax'));
assert(cookieHeader.includes('Max-Age=604800'));
const sessionCookie = response.headers
	.getSetCookie()
	.find((value) => value.startsWith('admin_session='));
assert(sessionCookie);
const cookie = sessionCookie.split(';')[0];
assert.equal((await fetch(login, { redirect: 'manual', headers: { cookie } })).status, 303);
for (const path of [
	'/admin-api/delete',
	'/api/admin/delete',
	'/admin-api/publish',
	'/api/admin/publish'
]) {
	const anonymous: Response = await fetch(new URL(path, ORIGIN), {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: ORIGIN },
		body: '{}'
	});
	assert.equal(anonymous.status, 401, 'Anonymous admin mutations must be rejected');
}
const authenticated = await fetch(new URL('/admin-api/delete', ORIGIN), {
	method: 'POST',
	headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
	body: '{}'
});
assert.equal(authenticated.status, 400, 'Authenticated requests reach input validation');
for (const path of ['/admin-api/games/active', '/api/games/active']) {
	const response: Response = await fetch(new URL(path, ORIGIN), {
		method: 'DELETE',
		headers: { 'content-type': 'application/json', origin: ORIGIN },
		body: JSON.stringify({ gameCode: crypto.randomUUID() })
	});
	assert.equal(response.status, 401, 'A game code does not authorize an anonymous mutation');
}
console.log(
	'HTTP admin smoke passed: email login, wrong-password rejection, safe redirects, cookie, and endpoint authorization.'
);
