import objectHash from 'object-hash';
import { mapIdlessSlidesMediaSync } from '$lib/types';
import type { LooseMediaReferencedFuizConfig } from '.';
import { StorageError } from './account';

export type LegacyRecord = {
	kind: 'creation' | 'report';
	sourceId: string;
	record: Record<string, unknown>;
};
export type LegacyPreview = { records: LegacyRecord[]; media: { id: string; media: unknown }[] };

export function prepareLegacyPreview(original: LegacyPreview): LegacyPreview {
	const preview = structuredClone(original);
	for (const item of preview.records) {
		if (item.kind !== 'creation' || !item.record.config) continue;
		item.record.config = mapIdlessSlidesMediaSync(
			item.record.config as LooseMediaReferencedFuizConfig,
			(media) => {
				if (!media) return undefined;
				if (typeof media === 'string')
					return { Image: { HashReference: { hash: media, alt: '' } } };
				if ('Base64' in media.Image) {
					const hash = media.Image.Base64.hash ?? objectHash(media.Image.Base64.data);
					if (!preview.media.some((image) => image.id === hash))
						preview.media.push({ id: hash, media });
					return { Image: { HashReference: { hash, alt: media.Image.Base64.alt } } };
				}
				return media;
			}
		);
	}
	return preview;
}

export function referencedLegacyMedia(value: unknown, hashes = new Set<string>()): Set<string> {
	if (!value || typeof value !== 'object') return hashes;
	if (
		'HashReference' in value &&
		value.HashReference &&
		typeof value.HashReference === 'object' &&
		'hash' in value.HashReference &&
		typeof value.HashReference.hash === 'string'
	)
		hashes.add(value.HashReference.hash);
	for (const item of Object.values(value)) referencedLegacyMedia(item, hashes);
	return hashes;
}
export function selectedLegacyImport(preview: LegacyPreview, selected: number[], copy: boolean) {
	const records = selected.map((index) => ({ ...structuredClone(preview.records[index]), copy }));
	const hashes = referencedLegacyMedia(records);
	const media = preview.media.filter((item) => hashes.has(item.id));
	if ([...hashes].some((hash) => !media.some((item) => item.id === hash)))
		throw new StorageError(422);
	return { records, media: structuredClone(media) };
}

// This reader is reachable only from the explicit administrator preview. Never upgrade,
// repair, normalize in place, or assign generated identifiers to the original database.
export async function readLegacyBrowser(): Promise<LegacyPreview> {
	if (!indexedDB.databases) throw new StorageError(503);
	if (!(await indexedDB.databases()).some((db) => db.name === 'FuizDB'))
		return { records: [], media: [] };
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('FuizDB');
		request.onupgradeneeded = () => {
			request.transaction?.abort();
			reject(new StorageError(503));
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		const names = ['creations', 'reports', 'images'].filter((name) =>
			database.objectStoreNames.contains(name)
		);
		if (!names.length) return { records: [], media: [] };
		return await new Promise<LegacyPreview>((resolve, reject) => {
			const preview: LegacyPreview = { records: [], media: [] };
			const transaction = database.transaction(names, 'readonly');
			transaction.onabort = () => reject(transaction.error);
			transaction.onerror = () => reject(transaction.error);
			transaction.oncomplete = () => resolve(preview);
			for (const name of names) {
				const request = transaction.objectStore(name).openCursor();
				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor) return;
					const value = structuredClone(cursor.value);
					if (name === 'images')
						preview.media.push({
							id: String(cursor.key),
							media:
								typeof value === 'string' ? { Image: { Base64: { data: value, alt: '' } } } : value
						});
					else
						preview.records.push({
							kind: name === 'creations' ? 'creation' : 'report',
							sourceId: value.uniqueId ?? `${name}:${String(cursor.key)}`,
							record: value
						});
					cursor.continue();
				};
			}
		});
	} finally {
		database.close();
	}
}
