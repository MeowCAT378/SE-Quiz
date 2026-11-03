import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/guards';
import {
	type LegacyPreview,
	prepareLegacyPreview,
	referencedLegacyMedia
} from '$lib/storage/legacy';
import { CREATION_MIME_TYPE, getDrive, REPORT_MIME_TYPE } from '../driveUtil';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	event.setHeaders({ 'cache-control': 'no-store' });
	const service = getDrive(event, true);
	let preview: LegacyPreview = { records: [], media: [] };
	const offset = Number(event.url.searchParams.get('offset') ?? 0);
	if (!Number.isSafeInteger(offset) || offset < 0) error(400, 'Invalid page');
	let index = 0;
	let total = 0;
	for (const [kind, mimeType] of [
		['creation', CREATION_MIME_TYPE],
		['report', REPORT_MIME_TYPE]
	] as const) {
		const files = await service.list<{
			id: string;
			name: string;
			properties: { lastEdited: string; versionId: string };
		}>(['id', 'name', 'properties'], { mimeType });
		total += files.length;
		files.sort((a, b) => a.id.localeCompare(b.id));
		for (const file of files) {
			const position = index++;
			if (position < offset || position >= offset + 25) continue;
			const body = await service.content(file);
			if (!body) error(503, 'Legacy source unavailable');
			const original = JSON.parse(body);
			const record = original.uniqueId
				? original
				: {
						...(kind === 'creation' ? { config: original } : original),
						uniqueId: file.name,
						lastEdited: Number(file.properties?.lastEdited),
						versionId: Number(file.properties?.versionId ?? 0)
					};
			preview.records.push({ kind, sourceId: file.name, record });
			if (new TextEncoder().encode(JSON.stringify(preview)).byteLength > 32 * 1024 * 1024)
				error(413, 'Preview too large');
		}
	}
	preview = prepareLegacyPreview(preview);
	const hashes = referencedLegacyMedia(preview.records);
	if (hashes.size > 100) error(413, 'Preview media limit exceeded');
	for (const hash of hashes) {
		if (preview.media.some((entry) => entry.id === hash)) continue;
		const files = await service.list<{ id: string }>(['id'], {
			name: hash,
			mimeType: 'text/plain'
		});
		if (files.length !== 1) continue;
		const body = await service.content(files[0]);
		if (body) {
			let media: unknown;
			try {
				media = JSON.parse(body);
			} catch {
				media = { Image: { Base64: { data: body, alt: '' } } };
			}
			preview.media.push({ id: hash, media });
		}
		if (new TextEncoder().encode(JSON.stringify(preview)).byteLength > 32 * 1024 * 1024)
			error(413, 'Preview too large');
	}
	return json({ ...preview, nextOffset: total > offset + 25 ? offset + 25 : null });
};
