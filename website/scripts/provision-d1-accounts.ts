// Private maintenance only: bun scripts/provision-d1-accounts.ts <database-name> [--remote]
// --remote must be explicit. Secrets are read from the maintenance environment, never CLI arguments.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEmail, validateAccountInput } from '../src/lib/server/accounts';
import { d1AccountUpgradeStatements } from '../src/lib/server/accountUpgradeD1';
import { d1LlmUpgradeStatements } from '../src/lib/server/llmUpgrade';
import { hashPassword } from '../src/lib/server/password';

const database = process.argv[2];
if (!database || database.startsWith('-')) throw new Error('A D1 database name is required');
const mode = process.argv.includes('--remote') ? '--remote' : '--local';
const directory = mkdtempSync(join(tmpdir(), 'seopen-d1-provision-'));
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function execute(statement: string, metadataFields?: string[]) {
	const file = join(directory, 'maintenance.sql');
	if (!metadataFields) writeFileSync(file, statement, { mode: 0o600 });
	const output = execFileSync(
		process.env.NODE_BINARY || 'node',
		[
			fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
			'd1',
			'execute',
			database,
			mode,
			'--json',
			...(metadataFields ? ['--command', statement] : ['--file', file])
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	);
	if (!metadataFields) return [];
	const result = JSON.parse(output);
	const rows: unknown =
		Array.isArray(result) && result.length === 1 ? result[0]?.results : undefined;
	if (
		!Array.isArray(rows) ||
		rows.some(
			(row) =>
				!row ||
				typeof row !== 'object' ||
				metadataFields.some((field) => typeof row[field] !== 'string')
		)
	)
		throw new Error('Invalid D1 metadata response');
	return rows as Record<string, string>[];
}
try {
	const columns = execute('PRAGMA table_info(admins);', ['name']).map((row) => row.name);
	if (columns.length) {
		const rows = execute(
			columns.includes('id') ? 'SELECT email,id FROM admins;' : 'SELECT email FROM admins;',
			['email']
		);
		const upgrade = d1AccountUpgradeStatements(
			columns as string[],
			rows as { email: string; id?: string | null }[]
		);
		execute(upgrade.join(';\n') + ';');
	}
	const llmColumns = execute('PRAGMA table_info(llm_configurations);', ['name']).map(
		(row) => row.name
	);
	const llmUpgrade = d1LlmUpgradeStatements(llmColumns);
	if (llmUpgrade.length) execute(llmUpgrade.join(';\n') + ';');
	execute(readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8'));
	const existing = execute(
		"SELECT id FROM admins WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1;",
		['id']
	);
	if (existing.length)
		console.log('Managed D1 accounts upgraded; existing administrator preserved.');
	else {
		const legacy = process.env.ADMIN_PASSWORD;
		const email = normalizeEmail(process.env.ADMIN_SEED_EMAIL || process.env.ADMIN_USERNAME || '');
		if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
			throw new Error('An explicit valid provisioning email is required');
		const password = legacy || process.env.ADMIN_SEED_PASSWORD;
		if (!password) throw new Error('Provisioning password is required');
		if (!legacy) validateAccountInput({ email, password });
		const hash = await hashPassword(password);
		execute(
			`INSERT INTO admins(id,email,password_hash,role) SELECT ${quote(crypto.randomUUID())},${quote(email)},${quote(hash)},'ADMIN' WHERE NOT EXISTS(SELECT 1 FROM admins WHERE role='ADMIN' AND deleted_at IS NULL);`
		);
		console.log('Managed D1 administrator provisioning checked.');
	}
} catch {
	console.error(
		'D1 maintenance failed. Check explicit provisioning settings, reserved email conflicts, database access, and Wrangler authentication. No credentials were printed.'
	);
	process.exitCode = 1;
} finally {
	rmSync(join(directory, 'maintenance.sql'), { force: true });
	rmdirSync(directory);
}
