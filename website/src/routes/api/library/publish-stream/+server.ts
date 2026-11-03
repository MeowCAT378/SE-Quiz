/**
 * Streaming publish endpoint
 * Sends progress updates as Server-Sent Events
 */

import { error, json } from '@sveltejs/kit';
import { v5 as uuidv5 } from 'uuid';

import { env } from '$env/dynamic/private';
import { stringifyToml, urlifyBase64 } from '$lib';
import type { BaseAI } from '$lib/ai/base';
import { createAI } from '$lib/ai/factory';
import { createGitClient } from '$lib/git/factory';
import { requireUser } from '$lib/server/guards';
import { getTitle, type IdlessFullFuizConfig, type ReferencingOnlineFuiz } from '$lib/types';

import { getAuthenticatedProvider, getTokens } from '../../git/gitUtil';
import type { RequestHandler } from './$types';
import type { PublishingState, PublishJob } from './types';

async function extractKeywords(
	ai: Pick<BaseAI, 'generateKeywords'>,
	config: IdlessFullFuizConfig
): Promise<string[]> {
	const input = config.slides.map(getTitle).join('\n');

	const content = await ai.generateKeywords(
		'Give up to sixteen keywords of the following user content to aid users find it while searching. Return only a JSON object with a keywords array of strings.',
		input
	);

	if (!content) {
		console.error('Invalid keywords AI response');
		return [];
	}

	try {
		const parsed: unknown = JSON.parse(content);
		if (
			!Array.isArray(parsed) ||
			!parsed.every((item): item is string => typeof item === 'string')
		) {
			console.error('Expected JSON array of strings from AI');
			return [];
		}
		return parsed;
	} catch {
		console.error('Failed to parse keywords AI response');
		return [];
	}
}

export const GET: RequestHandler = async (event) => {
	const user = requireUser(event);
	// EventSource uses GET, but this endpoint starts Git mutations, so it needs an origin gate.
	const origin = event.request.headers.get('origin');
	if (
		origin !== null
			? origin !== event.url.origin
			: event.request.headers.get('sec-fetch-site') !== 'same-origin'
	)
		error(403, 'Same-origin request required');
	const { url, locals, cookies } = event;
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

	// Get job ID from query params
	const jobId = url.searchParams.get('job');
	if (!jobId) {
		return json({ error: 'missing_job_id' }, { status: 400 });
	}

	// Retrieve job data from KV
	let job: PublishJob | null;
	try {
		job = await locals.publishJobsStore.get<PublishJob>(jobId, 'json');
	} catch {
		return json({ error: 'publish_unavailable' }, { status: 503 });
	}
	if (!job || job.ownerId !== user.id || job.sessionVersion !== user.sessionVersion || !job.fuiz) {
		return json({ error: 'job_not_found' }, { status: 404 });
	}

	// Consume before external effects. This get/delete pair is not an atomic queue claim;
	// failed publication needs a new job, and concurrent consumers are not serialized here.
	// Clean up job data
	try {
		await locals.publishJobsStore.delete(jobId);
	} catch {
		return json({ error: 'publish_unavailable' }, { status: 503 });
	}
	const fuizConfig = job.fuiz;

	// Create a readable stream for SSE
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			function send(event: 'progress', data: { state: PublishingState; message: string }): void;
			function send(event: 'complete', data: { pr_url: string }): void;
			function send(event: 'error', data: { message: string }): void;
			function send(event: string, data: Record<string, unknown>): void {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			}

			try {
				// Generate keywords using AI
				send('progress', { state: 'generating-keywords', message: 'Generating keywords...' });
				const ai = await createAI(event);
				const keywords = ai ? await extractKeywords(ai, fuizConfig.config) : [];

				// Fork repository
				send('progress', { state: 'forking', message: 'Forking repository...' });
				const client = createGitClient(provider, tokens);
				const { forkId, upstreamId } = await client.forkRepository();

				// Extract images and convert them to local references
				const [urlifiedConfig, images] = urlifyBase64(fuizConfig.config);

				const processedConfig: ReferencingOnlineFuiz = {
					...fuizConfig,
					keywords,
					config: urlifiedConfig
				};

				const tomlReadyConfig: ReferencingOnlineFuiz = {
					author: processedConfig.author,
					language: processedConfig.language,
					subjects: processedConfig.subjects,
					grades: processedConfig.grades,
					keywords,
					config: processedConfig.config
				};

				// Convert to TOML
				const tomlContent = stringifyToml(tomlReadyConfig);

				const fuizId = uuidv5(tomlContent, uuidv5.DNS);

				// Create branch
				send('progress', { state: 'creating-branch', message: 'Creating branch...' });
				const branchName = `submission/${fuizId}`;
				const defaultBranch = env.GIT_DEFAULT_BRANCH || 'main';

				await client.createBranch(forkId, branchName, defaultBranch);

				// Upload files
				send('progress', { state: 'uploading', message: 'Uploading files...' });

				const fileNameToPath = (fileName: string) => `${fuizId}/${fileName}`;

				const uniqueImageFiles = new Map<string, string>();
				for (const image of images) {
					if (!uniqueImageFiles.has(image.name)) {
						uniqueImageFiles.set(image.name, image.base64);
					}
				}

				const filesToUpload = [
					{
						path: fileNameToPath('config.toml'),
						content: tomlContent,
						encoding: 'text' as const
					},
					...uniqueImageFiles.entries().map(([name, base64]) => ({
						path: fileNameToPath(name),
						content: base64,
						encoding: 'base64' as const
					}))
				];

				await client.createMultipleFiles(
					forkId,
					filesToUpload,
					branchName,
					`Add fuiz: ${fuizConfig.config.title} (${filesToUpload.length} files)`
				);

				// Create PR
				send('progress', { state: 'creating-pr', message: 'Creating pull request...' });

				const prBody = `## Fuiz Submission

**Title:** ${fuizConfig.config.title}

**Author:** ${fuizConfig.author}

**Language:** ${fuizConfig.language}

**Subjects:** ${fuizConfig.subjects?.join(', ') || 'None'}

**Grades:** ${fuizConfig.grades?.join(', ') || 'None'}

### Details
- **Slides:** ${fuizConfig.config.slides.length}
- **Fuiz ID:** ${fuizId}
- **Images:** ${uniqueImageFiles.size} file(s)

---
*This PR was automatically created by the Fuiz publishing system.*
*Merge this PR to publish the fuiz to the public library.*`;

				const pr = await client.createPullRequest({
					sourceBranch: branchName,
					targetBranch: defaultBranch,
					sourceProjectId: forkId,
					targetProjectId: upstreamId,
					title: `[Submission] ${fuizConfig.config.title}`,
					description: prBody
				});

				// Send success
				send('complete', { pr_url: pr.url });
			} catch {
				send('error', { message: 'Publishing unavailable' });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store',
			Connection: 'keep-alive'
		}
	});
};
