import { describe, expect, it } from 'vitest';
import {
	defaultLlmSettings,
	resetLlmParameters,
	validateLlmSettings
} from '../src/lib/ai/llmConfiguration';
import { decryptLlmKey, encryptLlmKey } from '../src/lib/server/llmCrypto';
import { isForbiddenAddress, validateLlmEndpoint } from '../src/lib/server/llmDestinations';

const settings = () => ({
	...defaultLlmSettings(),
	name: 'Local',
	endpoint: 'http://localhost:11434/v1',
	model: 'served-model'
});
describe('LLM configuration trust boundaries', () => {
	it('initializes and resets the generation parameters', () => {
		const edited = {
			...settings(),
			temperature: 1,
			batchSize: 9,
			maxConcurrentOperations: 12,
			credential: { action: 'remove' },
			enabled: true
		};
		expect(resetLlmParameters(edited)).toEqual({
			...edited,
			temperature: 0.5,
			topP: 0.95,
			maxOutputTokens: 4096,
			requestTimeoutSeconds: 240,
			generationTimeoutSeconds: 900,
			batchSize: 3,
			maxConcurrentOperations: 2
		});
		expect(edited.batchSize).toBe(9);
	});
	it('rejects nonfinite, coerced, fractional and out-of-range inputs', () => {
		for (const value of [NaN, Infinity, '3', 0, 3.5, 21])
			expect(() => validateLlmSettings({ ...settings(), batchSize: value })).toThrow();
		for (const value of [NaN, Infinity, '3', 0, -1, 3.5, null, Number.MAX_SAFE_INTEGER + 1])
			expect(() =>
				validateLlmSettings({ ...settings(), maxConcurrentOperations: value })
			).toThrow();
		expect(
			validateLlmSettings({ ...settings(), maxConcurrentOperations: 1000 }).maxConcurrentOperations
		).toBe(1000);
		expect(
			validateLlmSettings({ ...settings(), maxConcurrentOperations: undefined })
				.maxConcurrentOperations
		).toBe(2);
		expect(validateLlmSettings(settings()).model).toBe('served-model');
		expect(() =>
			validateLlmSettings({ ...settings(), provider: 'claude', model: 'claude-opus-4-7' })
		).toThrow('unsupported_option');
		expect(
			validateLlmSettings({
				...settings(),
				provider: 'claude',
				model: 'claude-opus-4-7',
				temperature: null,
				topP: null
			}).temperature
		).toBeNull();
	});
	it('authenticates ciphertext and configuration identity without revealing keys', async () => {
		const secret = Buffer.alloc(32, 7).toString('base64');
		const cipher = await encryptLlmKey('tiny', 'config-a', secret);
		expect(cipher).not.toContain('tiny');
		expect(await encryptLlmKey('tiny', 'config-a', secret)).not.toBe(cipher);
		expect(await decryptLlmKey(cipher, 'config-a', secret)).toBe('tiny');
		await expect(decryptLlmKey(cipher, 'config-b', secret)).rejects.toThrow(
			'credential_unavailable'
		);
		await expect(decryptLlmKey(cipher, 'config-a', '')).rejects.toThrow('credential_unavailable');
	});
	it('accepts ADMIN-selected custom endpoints and rejects metadata and embedded credentials', () => {
		for (const endpoint of [
			settings().endpoint,
			'http://host.docker.internal:1234/v1',
			'https://llm.internal:8443/v1',
			'https://custom.example/v1'
		])
			expect(validateLlmEndpoint(endpoint).href).toBe(endpoint);
		for (const endpoint of [
			'http://user:key@localhost:11434/v1',
			'http://169.254.169.254/v1',
			'http://metadata.google.internal/v1',
			'https://custom.example/v1?key=secret',
			'https://custom.example/v1#fragment',
			'file:///etc/passwd'
		]) {
			expect(() => validateLlmEndpoint(endpoint)).toThrow();
		}
		for (const address of ['169.254.169.254', '::ffff:169.254.169.254', '0.0.0.0', 'ff02::1'])
			expect(isForbiddenAddress(address)).toBe(true);
		expect(isForbiddenAddress('2001:4860:4860::8888')).toBe(false);
		expect(isForbiddenAddress('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe(true);
	});
});
