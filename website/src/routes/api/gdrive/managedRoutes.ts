import { error, isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { isUuid } from '$lib/server/hostGames';
import { getPrivateResourceStore } from '$lib/server/privateResourceStore';
import {
	canonical,
	isMediaHash,
	ResourceError,
	type ResourceKind,
	validateMedia,
	validateRecord
} from '$lib/server/privateValidation';
import { readJsonBody } from '$lib/server/requestBody';
import { CREATION_MIME_TYPE, getDrive, getFilesIdFromName, REPORT_MIME_TYPE } from './driveUtil';

export const mimeFor = (kind: ResourceKind | 'image') =>
	kind === 'creation' ? CREATION_MIME_TYPE : kind === 'report' ? REPORT_MIME_TYPE : 'text/plain';
export async function managedDriveRoute(
	event: RequestEvent,
	kind: ResourceKind | 'image',
	id?: string
): Promise<Response> {
	event.setHeaders?.({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
	try {
		const actor = requireUser(event);
		const method = event.request.method;
		if (!['GET', 'HEAD'].includes(method)) requireSameOrigin(event);
		if (id && !(kind === 'image' ? isMediaHash(id) : isUuid(id))) error(400, 'Invalid identifier');
		const store = await getPrivateResourceStore(event);
		if (!store) error(503, 'Private storage unavailable');
		const drive = getDrive(event);
		const mime = mimeFor(kind);
		if (!id && kind !== 'image') {
			const owned = await store.list(actor, kind);
			const files = await drive.list<{ name: string }>(['name'], { mimeType: mime });
			return json(
				owned
					.filter(({ record }) => files.some((file) => file.name === record.uniqueId))
					.map(({ record }) => ({
						uniqueId: record.uniqueId,
						versionId: record.versionId,
						lastEdited: record.lastEdited
					}))
			);
		}
		if (!id) error(400, 'Identifier required');
		// Drive is a copy of server-owned data, never evidence of local ownership or a source
		// for silently restoring remote-only records. Legacy imports use a separate admin flow.
		const owned =
			kind === 'image'
				? await store.getMedia(actor, id)
				: (await store.get(actor, kind, id))?.record;
		if (!owned) error(404, 'Private record not found');
		const files = await getFilesIdFromName(drive, id, mime);
		if (method === 'DELETE') {
			for (const file of files) await drive.deleteFile(file);
			return new Response(null, { status: 204 });
		}
		if (!['GET', 'HEAD'].includes(method)) {
			const input = await readJsonBody(
				event.request,
				kind === 'image' ? 8 * 1024 * 1024 : 4 * 1024 * 1024
			);
			if (kind === 'image') {
				if (validateMedia(id, input).contentDigest !== validateMedia(id, owned).contentDigest)
					error(409, 'Media conflict');
			} else if (canonical(validateRecord(kind, input).record) !== canonical(owned))
				error(409, 'Save to private storage before synchronization');
		}
		let matched = false;
		for (const file of files) {
			const content = await drive.content(file);
			if (!content) error(503, 'Drive content unavailable');
			const value = JSON.parse(content);
			if (canonical(value) === canonical(owned)) matched = true;
			else if (kind === 'image' || value.versionId >= ('versionId' in owned ? owned.versionId : 0))
				error(409, 'Drive version conflict');
		}
		if (method === 'GET' || method === 'HEAD') {
			if (!matched) error(404, 'Current Drive copy not found');
			return method === 'HEAD' ? new Response(null) : json(owned);
		}
		if (!matched) {
			// ponytail: immutable version snapshots retain old copies; add retention only with explicit policy.
			await drive.create(
				{
					name: id,
					mimeType: mime,
					...('versionId' in owned
						? {
								properties: {
									versionId: String(owned.versionId),
									lastEdited: String(owned.lastEdited)
								}
							}
						: {})
				},
				{ type: mime, data: canonical(owned) }
			);
		}
		return new Response(null, { status: matched ? 200 : 201 });
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		if (cause instanceof ResourceError) error(cause.status, cause.message);
		error(503, 'Drive synchronization unavailable');
	}
}
