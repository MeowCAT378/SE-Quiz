import { link, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmError } from '../ai/llmConfiguration';
import { validateLlmSecret } from './llmCrypto';

export async function loadManagedLlmSecret(
	storagePath: string,
	legacySecret: string | undefined,
	hasEncryptedCredentials: () => Promise<boolean>
): Promise<string> {
	const directory = join(storagePath, '.llm-secrets');
	const path = join(directory, 'encryption.key');
	try {
		try {
			return validateLlmSecret(await readFile(path, 'utf8'));
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
		}
		// A missing key must never silently orphan credentials already stored in the database.
		if (!legacySecret && (await hasEncryptedCredentials()))
			throw new LlmError('credential_unavailable', 503);
		const secret = validateLlmSecret(
			legacySecret ?? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
		);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temporary = join(directory, `${crypto.randomUUID()}.tmp`);
		try {
			const file = await open(temporary, 'wx', 0o600);
			try {
				await file.writeFile(secret, 'utf8');
				await file.sync();
			} finally {
				await file.close();
			}
			try {
				// Publish a complete key without replacing the winner from another process.
				await link(temporary, path);
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
			}
		} finally {
			await rm(temporary, { force: true });
		}
		return validateLlmSecret(await readFile(path, 'utf8'));
	} catch {
		throw new LlmError('credential_unavailable', 503);
	}
}
