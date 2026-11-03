// Run with Bun, Docker Compose, POSIX sh/OpenSSL, and the built se-quiz-web:local image.
// Only synthetic seed values are used; generated environment contents are never printed.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal Compose interpolation syntax is under test
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('../../generate_config.sh', import.meta.url));
const values = [
	'plain-synthetic',
	'$UNSET_SYNTHETIC ${UNSET_SYNTHETIC} $$',
	'  synthetic\'s "quotes" # literal  ',
	"back\\slash\\'quote\\",
	'multiple\nlines\n'
];
const cleanEnv = { ...process.env };
for (const key of [
	'ADMIN_SEED_EMAIL',
	'ADMIN_SEED_PASSWORD',
	'UNSET_SYNTHETIC',
	'COMPOSE_FILE',
	'COMPOSE_ENV_FILES'
])
	delete cleanEnv[key];
for (const [index, password] of values.entries()) {
	const directory = mkdtempSync(join(tmpdir(), 'fuiz-config-check-'));
	try {
		const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';
		const generated = spawnSync(
			shell,
			['-c', 'PATH="/mingw64/bin:/usr/bin:$PATH"; export PATH; sh "$1" localhost', '--', generator],
			{
				cwd: directory,
				encoding: 'utf8',
				env: {
					...cleanEnv,
					ADMIN_SEED_EMAIL: 'synthetic@example.test',
					ADMIN_SEED_PASSWORD: password
				}
			}
		);
		if (generated.status !== 0) throw new Error(`Generator failed for synthetic case ${index}`);
		const checked = spawnSync(
			'docker',
			[
				'compose',
				'--env-file',
				'.env',
				'-f',
				'-',
				'run',
				'--rm',
				'--no-deps',
				'--entrypoint',
				'bun',
				'check',
				'-e',
				'const expected=Buffer.from(process.env.EXPECTED_BASE64,"base64").toString();if(process.env.ADMIN_SEED_PASSWORD!==expected||process.env.INTERPOLATED!==expected)process.exit(1);'
			],
			{
				cwd: directory,
				encoding: 'utf8',
				env: cleanEnv,
				input:
					'services:\n  check:\n    image: se-quiz-web:local\n    network_mode: none\n    env_file: .env\n    environment:\n      INTERPOLATED: ${ADMIN_SEED_PASSWORD}\n      EXPECTED_BASE64: ' +
					Buffer.from(password).toString('base64') +
					'\n'
			}
		);
		if (checked.status !== 0)
			throw new Error(`Container password round-trip failed for synthetic case ${index}`);
	} finally {
		// This exact directory was created above; never remove a project or persistent path.
		rmSync(directory, { recursive: true, force: true });
	}
}
console.log(`Compose literal-password round-trip passed (${values.length} synthetic cases).`);
