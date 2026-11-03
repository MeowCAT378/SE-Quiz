import type { RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { LlmError } from '../ai/llmConfiguration';
import type { LlmStore } from './llmStore';

export async function getLlmStore(event: Pick<RequestEvent, 'platform'>): Promise<LlmStore> {
	const d1 = event.platform?.env?.DATABASE;
	const provider = env.DB_PROVIDER || (d1 ? 'd1' : 'postgres');
	if (provider === 'd1' && d1) {
		const { D1LlmStore } = await import('./llmStoreD1');
		return new D1LlmStore(d1);
	}
	if (provider === 'postgres' && env.DATABASE_URL) {
		const { PostgresLlmStore } = await import('./llmStorePostgres');
		const { getPostgres } = await import('./postgres');
		return new PostgresLlmStore(getPostgres(env.DATABASE_URL));
	}
	throw new LlmError('configuration_unavailable', 503);
}
