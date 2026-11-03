import type { Base64Media } from '$lib/types';
import type { InternalFuiz, InternalReport, LocalDatabase } from '.';

/** Account caches never open or upgrade the unowned FuizDB legacy database. */
export async function loadLocalDatabase(accountId: string): Promise<LocalDatabase> {
	if (!/^[\da-f-]{36}$/i.test(accountId)) throw new Error('Verified account required');
	const request = indexedDB.open(`SEOpen-${accountId}`, 1);
	request.addEventListener('upgradeneeded', () => {
		for (const kind of ['creations', 'reports']) {
			const store = request.result.createObjectStore(kind, { autoIncrement: true });
			store.createIndex('uniqueId', 'uniqueId', { unique: true });
		}
		request.result.createObjectStore('images');
	});
	return new Promise((resolve, reject) => {
		request.onsuccess = () => {
			request.result.onversionchange = () => request.result.close();
			resolve(request.result);
		};
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error('Cache upgrade blocked'));
	});
}

/** Request success is provisional: a later transaction abort must reject the write. */
function completed<T>(transaction: IDBTransaction, value: () => T): Promise<T> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve(value());
		transaction.onabort = transaction.onerror = () =>
			reject(transaction.error ?? new Error('Cache transaction failed'));
	});
}
async function get<T>(db: LocalDatabase, kind: string, id: IDBValidKey): Promise<T | undefined> {
	const tx = db.transaction(kind, 'readonly');
	const request = tx.objectStore(kind).get(id);
	return completed(tx, () => request.result as T | undefined);
}
async function list<T>(db: LocalDatabase, kind: string): Promise<[number, T][]> {
	const tx = db.transaction(kind, 'readonly');
	const result: [number, T][] = [];
	const request = tx.objectStore(kind).openCursor();
	request.onsuccess = () => {
		const cursor = request.result;
		if (cursor) {
			result.push([Number(cursor.key), cursor.value]);
			cursor.continue();
		}
	};
	return completed(tx, () => result);
}
async function put(
	db: LocalDatabase,
	kind: string,
	record: InternalFuiz | InternalReport,
	id?: number
): Promise<number> {
	const tx = db.transaction(kind, 'readwrite');
	const store = tx.objectStore(kind);
	let key = id;
	const lookup = store.index('uniqueId').getKey(record.uniqueId);
	lookup.onsuccess = () => {
		const request = store.put(JSON.parse(JSON.stringify(record)), key ?? lookup.result);
		request.onsuccess = () => {
			key = Number(request.result);
		};
	};
	return completed(tx, () => key!);
}
async function remove(db: LocalDatabase, kind: string, id: number) {
	const tx = db.transaction(kind, 'readwrite');
	tx.objectStore(kind).delete(id);
	await completed(tx, () => undefined);
}
export const getAllCreationsLocal = (db: LocalDatabase) => list<InternalFuiz>(db, 'creations');
export const getCreationLocal = (id: number, db: LocalDatabase) =>
	get<InternalFuiz>(db, 'creations', id);
export const addCreationLocal = (record: InternalFuiz, db: LocalDatabase) =>
	put(db, 'creations', record);
export const updateCreationLocal = async (id: number, record: InternalFuiz, db: LocalDatabase) => {
	await put(db, 'creations', record, id);
};
export const deleteCreationLocal = (id: number, db: LocalDatabase) => remove(db, 'creations', id);
export const getAllReportsLocal = (db: LocalDatabase) => list<InternalReport>(db, 'reports');
export const getReportLocal = (id: number, db: LocalDatabase) =>
	get<InternalReport>(db, 'reports', id);
export const addReportLocal = (record: InternalReport, db: LocalDatabase) =>
	put(db, 'reports', record);
export const updateReportLocal = async (id: number, record: InternalReport, db: LocalDatabase) => {
	await put(db, 'reports', record, id);
};
export const deleteReportLocal = (id: number, db: LocalDatabase) => remove(db, 'reports', id);
export async function retrieveMediaFromLocal(
	hash: string,
	db: LocalDatabase,
	alt = ''
): Promise<Base64Media | undefined> {
	const media = await get<Base64Media>(db, 'images', hash);
	return media ? { Image: { Base64: { ...media.Image.Base64, alt } } } : undefined;
}
export async function updateLocalImagesDatabase(
	media: Base64Media,
	hash: string,
	db: LocalDatabase
): Promise<boolean> {
	const tx = db.transaction('images', 'readwrite');
	tx.objectStore('images').put(JSON.parse(JSON.stringify(media)), hash);
	return completed(tx, () => true);
}
