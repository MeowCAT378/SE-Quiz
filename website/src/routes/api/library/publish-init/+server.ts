/**
 * Initialize publish job
 * Creates a job ID and stores FullOnlineFuiz for streaming endpoint
 */

import { json } from '@sveltejs/kit';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { readJsonBody } from '$lib/server/requestBody';
import type { FullOnlineFuiz } from '$lib/types';
import { getAuthenticatedProvider, getTokens } from '../../git/gitUtil';
import type { PublishJob } from '../publish-stream/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const user = requireUser(event);
	requireSameOrigin(event);
	const { request, locals, cookies } = event;
	if (!locals.publishJobsStore) {
		return json({ error: 'publish_not_configured' }, { status: 503 });
	}

	// Check Git authentication
	const provider = getAuthenticatedProvider(cookies);
	if (!provider) {
		return json({ error: 'git_auth_required' }, { status: 401 });
	}

	const tokens = getTokens(cookies, provider);
	if (!tokens) {
		return json({ error: 'git_auth_required' }, { status: 401 });
	}

	const { fuiz } = await readJsonBody<{ fuiz: FullOnlineFuiz }>(request, 4 * 1024 * 1024);

	if (!fuiz || !fuiz.config || !fuiz.author || !fuiz.language) {
		return json({ error: 'missing_or_invalid_fuiz' }, { status: 400 });
	}

	try {
		// Generate job ID
		const jobId = crypto.randomUUID();

		// Store job data in KV with 10 minute expiration
		const job: PublishJob = { ownerId: user.id, sessionVersion: user.sessionVersion, fuiz };
		await locals.publishJobsStore.put(jobId, JSON.stringify(job), { expirationTtl: 600 });

		return json({ jobId });
	} catch {
		return json({ error: 'publish_unavailable' }, { status: 503 });
	}
};
