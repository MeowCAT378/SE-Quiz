import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('$env/dynamic/private', () => ({ env }));

import { legacyLlmPreview } from '../src/lib/server/llmService';

afterEach(() => {
	for (const key of Object.keys(env)) delete env[key];
});

describe('optional activity AI configuration', () => {
	it('stays disabled when URL or exact model ID is missing', async () => {
		expect(legacyLlmPreview().available).toBe(false);
		Object.assign(env, { LLM_BASE_URL: 'http://example.test/v1' });
		expect(legacyLlmPreview().available).toBe(false);
	});

	it('creates the existing OpenAI-compatible adapter only from server configuration', async () => {
		Object.assign(env, {
			LLM_ENABLED: 'true',
			LLM_PROVIDER: 'openai-compatible',
			LLM_BASE_URL: 'http://example.test/v1',
			LLM_MODEL: 'exact-served-id',
			LLM_MAX_OUTPUT_TOKENS: '1024',
			LLM_TEMPERATURE: '0.4',
			LLM_TOP_P: '0.9'
		});
		expect(legacyLlmPreview().available).toBe(true);
	});

	it('rejects invalid numeric configuration without affecting startup', async () => {
		Object.assign(env, {
			LLM_BASE_URL: 'http://example.test/v1',
			LLM_MODEL: 'exact-served-id',
			LLM_BATCH_SIZE: '0'
		});
		expect(legacyLlmPreview().available).toBe(false);
	});
});
