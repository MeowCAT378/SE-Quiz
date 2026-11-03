import { expect, it } from 'vitest';
import { base, resolve } from '$app/paths';
import {
	baseLocale,
	deLocalizeUrl,
	extractLocaleFromRequest,
	locales,
	localizeHref,
	localizeUrl
} from '../src/lib/paraglide/runtime';
import { match } from '../src/params/locale';

it('accepts configured locales and prevents API prefixes being consumed as a locale', () => {
	expect(baseLocale).toBe('th');
	expect(locales).toEqual(['th', 'en']);
	for (const locale of ['th', 'en']) expect(match(locale)).toBe(true);
	for (const prefix of [
		'ar',
		'az',
		'de',
		'es',
		'eu',
		'fr',
		'it',
		'id',
		'nl',
		'pl',
		'zh-cn',
		'api',
		'admin-api',
		'register',
		'unknown'
	])
		expect(match(prefix)).toBe(false);
});

it('defaults unprefixed pages to Thai even with an English browser preference', () => {
	const request = new Request(`http://localhost${base}/create`, {
		headers: { 'Accept-Language': 'en-US,en;q=0.9' }
	});
	expect(extractLocaleFromRequest(request)).toBe('th');
});

it.each([
	'http://localhost',
	'http://localhost:9399',
	'https://quiz.example:8443'
])('switches Thai and English URLs without losing origin, route, query or fragment at %s', (origin) => {
	const thai = new URL(`${origin}${base}/library?search=quiz#results`);
	const english = localizeUrl(thai, { locale: 'en' });
	expect(english.href).toBe(`${origin}${base}/en/library?search=quiz#results`);
	expect(extractLocaleFromRequest(new Request(english))).toBe('en');
	expect(localizeUrl(english, { locale: 'th' }).href).toBe(thai.href);
	expect(deLocalizeUrl(english).href).toBe(thai.href);
	expect(deLocalizeUrl(`${origin}${base}/th/library`).href).toBe(`${origin}${base}/library`);
});

it('prefixes logical localized links once and preserves a deployed URL when switching locales', () => {
	expect(resolve(localizeHref('/play?code=123', { locale: 'en' }))).toBe(
		`${base}/en/play?code=123`
	);
	expect(localizeUrl(`http://localhost${base}/en/quiz/1?x=1#title`, { locale: 'th' }).href).toBe(
		`http://localhost${base}/quiz/1?x=1#title`
	);
});
