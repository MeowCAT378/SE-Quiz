import { LlmError } from '../ai/llmConfiguration';

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export function validateLlmSecret(secret: string): string {
	try {
		const bytes = decode(secret);
		if (bytes.length !== 32 || encode(bytes) !== secret) throw new Error('invalid key');
		return secret;
	} catch {
		throw new LlmError('credential_unavailable', 503);
	}
}
async function encryptionKey(secret: string) {
	const bytes = decode(validateLlmSecret(secret));
	return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptLlmKey(value: string, id: string, secret: string): Promise<string> {
	try {
		const key = await encryptionKey(secret);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`llm-key:v1:${id}`) },
			key,
			new TextEncoder().encode(value)
		);
		return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
	} catch {
		throw new LlmError('credential_unavailable', 503);
	}
}
export async function decryptLlmKey(
	ciphertext: string,
	id: string,
	secret: string
): Promise<string> {
	try {
		const [version, iv, body, extra] = ciphertext.split('.');
		if (version !== 'v1' || extra !== undefined) throw new Error('invalid envelope');
		const key = await encryptionKey(secret);
		const value = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: decode(iv),
				additionalData: new TextEncoder().encode(`llm-key:v1:${id}`)
			},
			key,
			decode(body)
		);
		return new TextDecoder('utf-8', { fatal: true }).decode(value);
	} catch {
		throw new LlmError('credential_unavailable', 503);
	}
}
