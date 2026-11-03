// Run with Node and POSIX sh/OpenSSL. Uses temporary synthetic environments only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('../../generate_config.sh', import.meta.url)).replaceAll(
	'\\',
	'/'
);
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';
const configUrl = new URL('../svelte.config.js', import.meta.url).href;
const entrypoint = fileURLToPath(
	new URL('../../docker/nginx/entrypoint.sh', import.meta.url)
).replaceAll('\\', '/');
const invalidBases = ['/', '/a/', 'relative', '/a//b', '/../x', '/a.b', '/x\n'];
for (const base of ['', '/SEQuiz', '/informatics/SEQuiz']) {
	const result = spawnSync(
		process.execPath,
		['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`],
		{
			env: { ...process.env, BASE_PATH: base }
		}
	);
	assert.equal(result.status, 0, `Valid build prefix rejected: ${base}`);
}
for (const base of invalidBases) {
	const result = spawnSync(
		process.execPath,
		['--input-type=module', '-e', `await import(${JSON.stringify(configUrl)})`],
		{
			env: { ...process.env, BASE_PATH: base }
		}
	);
	assert.notEqual(result.status, 0, `Invalid build prefix accepted: ${JSON.stringify(base)}`);
	const startup = spawnSync(shell, ['-c', 'sh "$1"', '--', entrypoint], {
		encoding: 'utf8',
		env: { ...process.env, BASE_PATH: base }
	});
	assert.equal(startup.status, 1, `Invalid Nginx prefix accepted: ${JSON.stringify(base)}`);
	assert.match(startup.stderr, /BASE_PATH must/);
}

for (const [host, port, base] of [
	['localhost', '80', '/SEQuiz'],
	['example.test', '9399', '/informatics/SEQuiz']
]) {
	const directory = mkdtempSync(join(tmpdir(), 'sequiz-nginx-config-'));
	const file = join(directory, '.env');
	const generate = (configuredBase = base) =>
		spawnSync(
			shell,
			[
				'-c',
				'PATH="/mingw64/bin:/usr/bin:$PATH"; export PATH; sh "$1" "$2"',
				'--',
				generator,
				host
			],
			{
				cwd: directory,
				encoding: 'utf8',
				env: {
					...process.env,
					ADMIN_SEED_EMAIL: 'synthetic@example.test',
					ADMIN_SEED_PASSWORD: 'synthetic-only',
					NGINX_PORT: port,
					BASE_PATH: configuredBase
				}
			}
		);
	try {
		assert.equal(generate().status, 0, `Generator failed for synthetic port ${port}`);
		const original = readFileSync(file);
		const values = new Map(
			original
				.toString()
				.split('\n')
				.map((line) => {
					const index = line.indexOf('=');
					return [line.slice(0, index), line.slice(index + 1)];
				})
		);
		const authority = port === '80' ? host : `${host}:${port}`;
		const origin = `http://${authority}`;
		for (const [key, expected] of Object.entries({
			NGINX_PORT: port,
			BASE_PATH: base,
			ORIGIN: origin,
			PUBLIC_PLAY_URL: origin,
			PUBLIC_DISPLAY_PLAY_URL: `${authority}${base}`,
			PUBLIC_BACKEND_URL: `${origin}${base}/backend`,
			PUBLIC_WS_URL: `ws://${authority}${base}/backend`,
			PUBLIC_CORKBOARD_URL: `${origin}${base}/media`,
			FUIZ_ALLOWED_ORIGINS: JSON.stringify([origin]),
			CORKBOARD_ALLOWED_ORIGINS: JSON.stringify([origin]),
			SEED_DEMO_GAMES: host === 'localhost' ? 'true' : 'false'
		})) {
			assert.equal(values.get(key), expected, `${key} routing mismatch`);
		}
		assert.notEqual(generate().status, 0, 'Generator must refuse an existing environment');
		assert.deepEqual(readFileSync(file), original, 'Existing environment bytes changed');
		rmSync(file);
		for (const invalid of invalidBases) {
			const rejected = generate(invalid);
			assert.equal(
				rejected.status,
				1,
				`Invalid generated prefix accepted: ${JSON.stringify(invalid)}`
			);
			assert.match(rejected.stderr, /BASE_PATH must/);
		}
	} finally {
		// Only the known synthetic file and exact directory created above are removed.
		rmSync(file, { force: true });
		rmdirSync(directory);
	}
}

console.log(
	'Nginx environment generation: default/nested prefixes, custom ports and no-overwrite PASS'
);
