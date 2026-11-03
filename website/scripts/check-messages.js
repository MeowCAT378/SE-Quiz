import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLocales, getTranslations } from './message-utils.js';

const en = getTranslations();
const enKeys = Object.keys(en);
const configuredLocales = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'project.inlang', 'settings.json'), 'utf8')
).locales;
const messageLocales = getLocales().sort();

if (configuredLocales.some((locale) => !messageLocales.includes(locale))) {
	console.error('A configured locale is missing its message file.');
	process.exit(1);
}

const locales = getLocales().filter((l) => l !== 'en');

let failed = false;

for (const locale of locales.sort()) {
	const raw = readFileSync(join(import.meta.dirname, '..', 'messages', `${locale}.json`), 'utf8');
	const data = getTranslations(locale);
	const keys = Object.keys(data);
	const errors = [];
	const rawKeys = [...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]);
	const duplicates = rawKeys.filter((key, index) => rawKeys.indexOf(key) !== index);

	const extra = keys.filter((k) => !enKeys.includes(k));
	const missing = enKeys.filter((k) => !keys.includes(k));

	if (extra.length) {
		errors.push(`extra keys: ${extra.join(', ')}`);
	}

	if (missing.length) {
		errors.push(`missing keys: ${missing.join(', ')}`);
	}
	if (duplicates.length) {
		errors.push(`duplicate keys: ${[...new Set(duplicates)].join(', ')}`);
	}

	for (const key of enKeys.filter((candidate) => keys.includes(candidate))) {
		const parameters = (value) =>
			[...value.matchAll(/\{(\w+)\}/g)]
				.map((match) => match[1])
				.sort()
				.join(',');
		if (parameters(data[key]) !== parameters(en[key])) {
			errors.push(`placeholder mismatch: ${key}`);
		}
	}

	const filtered = keys.filter((k) => enKeys.includes(k));
	const expected = enKeys.filter((k) => keys.includes(k));
	if (filtered.join(',') !== expected.join(',')) {
		errors.push('key order does not match en.json');
	}

	if (errors.length) {
		console.error(`FAIL ${locale}.json:`);
		for (const e of errors) {
			console.error(`  - ${e}`);
		}
		failed = true;
	} else {
		console.log(`OK   ${locale}.json`);
	}
}

if (failed) {
	console.error('\nMessage files are out of sync with en.json');
	process.exit(1);
} else {
	console.log('\nAll message files are in sync with en.json');
}
