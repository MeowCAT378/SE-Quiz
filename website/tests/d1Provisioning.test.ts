import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ sql: '', commands: [] as string[][], invalidMetadata: false }));
vi.mock('node:child_process', () => ({
	execFileSync: vi.fn((_binary: string, args: string[]) => {
		calls.commands.push(args);
		if (args.includes('--file')) return JSON.stringify([{ results: [{ total_queries: 1 }] }]);
		if (calls.invalidMetadata) return JSON.stringify([{ results: [{ total_queries: 1 }] }]);
		const query = args[args.indexOf('--command') + 1];
		if (query === 'PRAGMA table_info(admins);') return JSON.stringify([{ results: [] }]);
		if (query === 'PRAGMA table_info(llm_configurations);')
			return JSON.stringify([{ results: [] }]);
		if (query === "SELECT id FROM admins WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1;")
			return JSON.stringify([{ results: [] }]);
		throw new Error('Unexpected metadata query');
	})
}));
vi.mock('node:fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:fs')>()),
	mkdtempSync: () => 'test-maintenance-directory',
	writeFileSync: vi.fn((_path: string, statement: string) => {
		calls.sql = statement;
	}),
	readFileSync: () => 'CREATE TABLE example(id TEXT);',
	rmSync: vi.fn(),
	rmdirSync: vi.fn()
}));
vi.mock('../src/lib/server/password', () => ({
	hashPassword: async () => 'synthetic-private-hash',
	verifyPassword: vi.fn()
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
	process.argv = originalArgv;
	process.exitCode = originalExitCode;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	calls.commands = [];
	calls.sql = '';
	calls.invalidMetadata = false;
});

it('rejects import summaries instead of accepting them as metadata rows', async () => {
	vi.resetModules();
	calls.invalidMetadata = true;
	process.argv = ['bun', 'provision-d1-accounts.ts', 'disposable-test-db', '--remote'];
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	await import('../scripts/provision-d1-accounts');
	expect(error).toHaveBeenCalledOnce();
	expect(process.exitCode).toBe(1);
	expect(calls.commands).toHaveLength(1);
	expect(calls.sql).toBe('');
});

it.each([
	'--local',
	'--remote'
])('uses row-returning commands for %s metadata and files for private writes', async (mode) => {
	vi.resetModules();
	process.argv = ['bun', 'provision-d1-accounts.ts', 'disposable-test-db', mode];
	vi.stubEnv('ADMIN_USERNAME', 'legacy@example.test');
	vi.stubEnv('ADMIN_SEED_EMAIL', '');
	vi.stubEnv('ADMIN_PASSWORD', 'old');
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	await import('../scripts/provision-d1-accounts');
	expect(error).not.toHaveBeenCalled();
	expect(
		calls.commands.filter((args) => args.includes('--command')).map((args) => args.at(-1))
	).toEqual([
		'PRAGMA table_info(admins);',
		'PRAGMA table_info(llm_configurations);',
		"SELECT id FROM admins WHERE role='ADMIN' AND deleted_at IS NULL LIMIT 1;"
	]);
	expect(calls.commands.filter((args) => args.includes('--file'))).toHaveLength(2);
	expect(calls.sql).toContain('synthetic-private-hash');
	expect(JSON.stringify(calls.commands)).not.toContain('synthetic-private-hash');
	expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private-hash');
});
