import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { getTranslations } from './message-utils.js';

const srcDir = join(import.meta.dirname, '..', 'src');

const en = getTranslations();
const keys = Object.keys(en);

// Retained upstream marketing/demo messages: CatchUp does not render these sections.
// Keep their translations available without adding UI solely to consume a key.
const reserved = new Set([
	'greeting',
	'create_with',
	'beautiful_design',
	'lightweight',
	'privacy_friendly',
	'collab_over_comp_desc',
	'collab_over_comp',
	'about_fuiz_desc',
	'about_fuiz',
	'which_feature',
	'join_community',
	'join_community_subtitle',
	'join_slack'
]);

function collectFiles(dir) {
	const results = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (entry === 'paraglide') continue;
		if (statSync(full).isDirectory()) {
			results.push(...collectFiles(full));
		} else if (['.svelte', '.ts', '.js'].includes(extname(full))) {
			results.push(full);
		}
	}
	return results;
}

const files = collectFiles(srcDir);
const allSource = files.map((f) => readFileSync(f, 'utf-8')).join('\n');

const unused = keys.filter((key) => {
	const pattern = `m.${key}`;
	return !allSource.includes(pattern) && !reserved.has(key);
});

if (unused.length) {
	console.error(`Found ${unused.length} unused translation key(s):\n`);
	for (const key of unused) {
		console.error(`  - ${key}: ${JSON.stringify(en[key])}`);
	}
	process.exit(1);
} else {
	console.log(
		`All application translation keys are used (${reserved.size} reserved upstream keys retained).`
	);
}
