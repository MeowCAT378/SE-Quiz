import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FilesystemBlobStorage } from '../src/lib/blob/filesystem';
import { decryptLlmKey, encryptLlmKey } from '../src/lib/server/llmCrypto';
import { loadManagedLlmSecret } from '../src/lib/server/llmSecret';

it('persists one private key across concurrent starts and preserves legacy ciphertext', async () => {
	const storage = await mkdtemp(join(tmpdir(), 'llm-secret-'));
	const path = join(storage, '.llm-secrets', 'encryption.key');
	try {
		const secrets = await Promise.all(
			Array.from({ length: 8 }, () => loadManagedLlmSecret(storage, undefined, async () => false))
		);
		expect(new Set(secrets).size).toBe(1);
		expect(await new FilesystemBlobStorage(storage).get('.llm-secrets/encryption.key')).toBeNull();
		expect(await readdir(join(storage, '.llm-secrets'))).toEqual(['encryption.key']);
		const ciphertext = await encryptLlmKey('synthetic-key', 'config', secrets[0]);
		const persisted = await loadManagedLlmSecret(
			storage,
			'ignored-after-bootstrap',
			async () => true
		);
		expect(await decryptLlmKey(ciphertext, 'config', persisted)).toBe('synthetic-key');
		if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
		await rm(path);
		await expect(loadManagedLlmSecret(storage, undefined, async () => true)).rejects.toThrow(
			'credential_unavailable'
		);
		expect(await readdir(join(storage, '.llm-secrets'))).toEqual([]);
		expect(await loadManagedLlmSecret(storage, persisted, async () => true)).toBe(persisted);
		expect(await decryptLlmKey(ciphertext, 'config', await readFile(path, 'utf8'))).toBe(
			'synthetic-key'
		);
		await writeFile(path, 'corrupted');
		await expect(loadManagedLlmSecret(storage, persisted, async () => false)).rejects.toThrow(
			'credential_unavailable'
		);
		expect(await readFile(path, 'utf8')).toBe('corrupted');
	} finally {
		await rm(storage, { recursive: true, force: true });
	}
});
