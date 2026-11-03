import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import { requireAdmin, requireSameOrigin } from '$lib/server/guards';
import { readJsonBody } from '$lib/server/requestBody';
import { getThumbnail } from '$lib/serverOnlyUtils';
import type { FullOnlineFuiz, IdlessFullFuizConfig } from '$lib/types';

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	requireSameOrigin(event);
	const { request, locals } = event;

	if (!locals.database || !locals.blobStorage) {
		return json({ error: 'Library service unavailable' }, { status: 503 });
	}
	const body = await readJsonBody<{
		config: IdlessFullFuizConfig;
		id?: string;
		author?: string;
		language?: string;
		subjects?: string[];
		grades?: string[];
		keywords?: string[];
	}>(request, 4 * 1024 * 1024);
	if (
		body.id !== undefined &&
		(typeof body.id !== 'string' ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id))
	)
		return json({ error: 'Invalid quiz ID' }, { status: 400 });

	try {
		const config = body.config as IdlessFullFuizConfig;

		if (!config || !config.title || !Array.isArray(config.slides)) {
			return json({ error: 'Invalid quiz configuration.' }, { status: 400 });
		}

		const id = body.id || randomUUID();
		const author = body.author || 'Admin';
		const language = body.language || 'th';
		const subjects = Array.isArray(body.subjects) ? body.subjects : [];
		const grades = Array.isArray(body.grades) ? body.grades : [];
		const keywords = Array.isArray(body.keywords) ? body.keywords : [];

		// Generate thumbnail
		let thumbnailData: { thumbnail: ArrayBuffer; thumbnailAlt: string } | undefined;
		try {
			thumbnailData = await getThumbnail(config);
		} catch {
			// A thumbnail is optional; publishing preserves the quiz without one.
		}

		// Store full quiz JSON into blob storage (filesystem)
		const fullConfig: FullOnlineFuiz = {
			config,
			author,
			language,
			subjects,
			grades,
			keywords
		};

		await locals.blobStorage.put(id, JSON.stringify(fullConfig));

		// Insert or replace the public-library record.
		await locals.database.insertFuiz({
			id,
			storage_id: id,
			title: config.title,
			author,
			language,
			subjects: subjects.length > 0 ? JSON.stringify(subjects) : null,
			grades: grades.length > 0 ? JSON.stringify(grades) : null,
			keywords: keywords.length > 0 ? JSON.stringify(keywords) : null,
			slides_count: config.slides.length,
			thumbnail: thumbnailData?.thumbnail || null,
			thumbnail_alt: thumbnailData?.thumbnailAlt || null,
			git_commit_sha: null,
			played_count: 0,
			view_count: 0,
			published_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		});

		return json({ success: true, id, message: 'Quiz published successfully!' });
	} catch {
		return json({ error: 'Library service unavailable' }, { status: 503 });
	}
};
