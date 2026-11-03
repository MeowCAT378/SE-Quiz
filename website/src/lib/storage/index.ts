import objectHash from 'object-hash';
import {
	type Base64Media,
	type Creation,
	type GenericIdlessFuizConfig,
	getMedia,
	type IdlessFullFuizConfig,
	type Media,
	type Modify,
	mapIdlessSlidesMedia,
	mapIdlessSlidesMediaSync,
	type QuestionType
} from '../types';
import { toSorted } from '../util';
import {
	type AccountBinding,
	accountRequest,
	currentIdentity,
	registerAccountStorage,
	StorageError,
	verifyAccount
} from './account';
import {
	addCreationLocal,
	addReportLocal,
	deleteCreationLocal,
	deleteReportLocal,
	getAllCreationsLocal,
	getAllReportsLocal,
	getCreationLocal,
	getReportLocal,
	loadLocalDatabase,
	updateCreationLocal,
	updateLocalImagesDatabase,
	updateReportLocal
} from './local';
import { type RemoteSync, type RemoteSyncProvider, retrieveRemoteSync } from './remoteStorage';

export {
	accountRequest,
	clearAccountStorage,
	onAccountStorageCleared,
	StorageError,
	verifyAccount
} from './account';

export type LocalDatabase = IDBDatabase;
export type CreationId = number;
export type ReportId = number;

/**
 * How a set of players performed in one hosted game.
 *
 * `fuizUniqueId` is the relational link back to the creation it was played from, but the
 * question titles are snapshotted alongside it: the quiz may be edited, deleted, or never
 * have been local at all (joined by code, opened from a share link), and the report still
 * has to render. `fuizVersionId` records which version was played so a later drift can be
 * flagged rather than silently misattributed.
 */
export type ReportBody = {
	title: string;
	playedAt: number;
	gameCode?: string;
	/** Verified runtime instance; absent on historical reports. */
	gameInstanceId?: string;
	fuizUniqueId?: string;
	fuizVersionId?: number;
	playerCount: number;
	scoreMode?: 'points' | 'correctness';
	/**
	 * `pointsAwarded` is what the question could award at most. A report that
	 * omits it is read as scored, which fills every cell of its sheet.
	 */
	questions: {
		id?: number;
		type?: QuestionType;
		title: string;
		correctAnswer?: string;
		correct: number;
		wrong: number;
		pointsAwarded?: number;
	}[];
	results: [string, number[]][];
	teams?: [string, string[]][];
	/**
	 * What each player actually said, one entry per question, in the slide's own
	 * phrasing: the picked option, the typed sentence, the slider value with its
	 * unit. Absent when no answers were captured, such as a game whose host never
	 * reached a results screen; an empty string means that player skipped that
	 * question.
	 *
	 * Kept beside `results` rather than folded into it because the two answer
	 * different questions: `results` is the gradebook, this is the response log.
	 */
	responses?: [string, string[]][];
};

export type InternalReport = ReportBody & InternalFuizMetadata;

export type Database = AccountBinding & {
	local: LocalDatabase;
	remote?: RemoteSync;
	availableProviders: Array<{ provider: RemoteSyncProvider; authenticated: boolean }>;
	syncWarning?: boolean;
};

export type ExportedFuiz = {
	config: IdlessFullFuizConfig;
} & InternalFuizMetadata;

type MediaReference = {
	Image: {
		HashReference: {
			hash: string;
			alt: string;
		};
	};
};

type LooseMediaReference = Base64Media | MediaReference | string;

export type LooseMediaReferencedFuizConfig = GenericIdlessFuizConfig<
	LooseMediaReference | undefined
>;
export type MediaReferencedFuizConfig = GenericIdlessFuizConfig<MediaReference | undefined>;

export type LooseInternalFuizMetadata = {
	lastEdited: number;
	uniqueId?: string;
	versionId?: number;
};

export type InternalFuiz = {
	config: MediaReferencedFuizConfig;
} & InternalFuizMetadata;

export type InternalFuizMetadata = Modify<
	LooseInternalFuizMetadata,
	{
		uniqueId: string;
		versionId: number;
	}
>;

export type InternalFuizMetadataStrings = Modify<
	InternalFuizMetadata,
	{
		lastEdited: string;
		versionId: string;
	}
>;

export function generateUuid(): string {
	return crypto.randomUUID();
}

function hashMedia(media: Base64Media): {
	hash: string;
	alt: string;
	dataUri: string;
} {
	const hash = media.Image.Base64.hash ?? objectHash(media.Image.Base64.data);
	return {
		hash,
		alt: media.Image.Base64.alt,
		dataUri: media.Image.Base64.data
	};
}

async function updateImagesDatabse(media: Base64Media, hash: string, database: Database) {
	await accountRequest(database, `/api/host/media/${encodeURIComponent(hash)}`, {
		method: 'PUT',
		body: JSON.stringify(media)
	});
	await updateLocalImagesDatabase(media, hash, database.local);
	await optionalSync(database, () => database.remote?.createImage(hash, media));
}

async function internalizeFuiz(fuiz: ExportedFuiz, database: Database): Promise<InternalFuiz> {
	const images = new Map<string, Base64Media>();
	const internal: InternalFuiz = {
		...fuiz,
		config: mapIdlessSlidesMediaSync(fuiz.config, (media) => {
			if (!media) return undefined;
			const { hash, alt } = hashMedia(media);
			images.set(hash, media);
			return { Image: { HashReference: { hash, alt } } };
		})
	};
	// Key ordering does not change UTF-8 byte length. Check the stored shape, not embedded image bytes.
	if (new TextEncoder().encode(JSON.stringify(internal)).byteLength > 1_900_000)
		throw new StorageError(413);
	for (const [hash, media] of images) await updateImagesDatabse(media, hash, database);
	return internal;
}

async function collectMedia(
	media: MediaReference | undefined,
	database: Database
): Promise<Base64Media | undefined> {
	if (media === undefined) return undefined;
	if ('HashReference' in media.Image) {
		const { hash, alt } = media.Image.HashReference;
		const value: Base64Media = await (
			await accountRequest(database, `/api/host/media/${encodeURIComponent(hash)}`)
		).json();
		await updateLocalImagesDatabase(value, hash, database.local);
		return { Image: { Base64: { ...value.Image.Base64, alt } } };
	}
	return {
		Image: media.Image
	};
}

async function collectFuiz(fuiz: InternalFuiz, database: Database): Promise<ExportedFuiz> {
	const collectMediaClosure = async (media: MediaReference | undefined) =>
		await collectMedia(media, database);
	return {
		...fuiz,
		config: await mapIdlessSlidesMedia(fuiz.config, collectMediaClosure)
	};
}

export async function loadDatabase(): Promise<Database> {
	const identity = await currentIdentity();
	const local = await loadLocalDatabase(identity.user.id);
	const database: Database = {
		...identity,
		local,
		availableProviders: [],
		closed: false,
		close() {
			local.close();
			database.remote = undefined;
			database.availableProviders = [];
		}
	};
	registerAccountStorage(database);
	await verifyAccount(database);
	database.availableProviders = await retrieveRemoteSync();
	const provider = database.availableProviders.find((p) => p.authenticated);
	if (provider) database.remote = new provider.provider(database);
	return database;
}

async function optionalSync(database: Database, work: () => Promise<void> | undefined) {
	try {
		await work();
	} catch {
		database.syncWarning = true;
	}
	if (database.closed) throw new StorageError(401);
}

// Only server snapshots enter the cache. Stale/deleted local rows are removed after list ACK.
async function refreshCreations(database: Database): Promise<[number, InternalFuiz][]> {
	const { resources }: { resources: { record: InternalFuiz }[] } = await (
		await accountRequest(database, '/api/creations')
	).json();
	const present = new Set(resources.map(({ record }) => record.uniqueId));
	for (const [id, old] of await getAllCreationsLocal(database.local)) {
		if (!present.has(old.uniqueId)) await deleteCreationLocal(id, database.local);
	}
	const result: [number, InternalFuiz][] = [];
	for (const { record } of resources)
		result.push([await addCreationLocal(record, database.local), record]);
	return result;
}
async function refreshReports(database: Database): Promise<[number, InternalReport][]> {
	const { resources }: { resources: { record: InternalReport }[] } = await (
		await accountRequest(database, '/api/reports')
	).json();
	const present = new Set(resources.map(({ record }) => record.uniqueId));
	for (const [id, old] of await getAllReportsLocal(database.local)) {
		if (!present.has(old.uniqueId)) await deleteReportLocal(id, database.local);
	}
	const result: [number, InternalReport][] = [];
	for (const { record } of resources)
		result.push([await addReportLocal(record, database.local), record]);
	return result;
}
export async function syncRemote(database: Database): Promise<void> {
	const rows = await refreshCreations(database);
	await optionalSync(database, () => database.remote?.sync(database.local, rows));
}
export async function getLocalCreations(database: Database): Promise<Creation[]> {
	return Promise.all(
		(await refreshCreations(database)).map(async ([id, record]) => {
			const value = await collectFuiz(record, database);
			return {
				id,
				uniqueId: value.uniqueId,
				lastEdited: value.lastEdited,
				title: value.config.title,
				slidesCount: value.config.slides.length,
				media: value.config.slides.reduce<Media | undefined>((p, c) => p || getMedia(c), undefined)
			};
		})
	);
}
export const getAllCreations = getLocalCreations;
export async function getCreation(
	id: CreationId,
	database: Database
): Promise<ExportedFuiz | undefined> {
	await verifyAccount(database);
	const alias = await getCreationLocal(id, database.local);
	if (!alias) return undefined;
	try {
		const { record }: { record: InternalFuiz } = await (
			await accountRequest(database, `/api/creations/${alias.uniqueId}`)
		).json();
		await updateCreationLocal(id, record, database.local);
		return collectFuiz(record, database);
	} catch (cause) {
		if (cause instanceof StorageError && cause.status === 404) {
			await deleteCreationLocal(id, database.local);
			return undefined;
		}
		throw cause;
	}
}
export async function deleteCreation(id: CreationId, database: Database): Promise<void> {
	await verifyAccount(database);
	const record = await getCreationLocal(id, database.local);
	if (!record) return;
	await optionalSync(database, () => database.remote?.delete(record.uniqueId));
	try {
		await accountRequest(database, `/api/creations/${record.uniqueId}`, {
			method: 'DELETE',
			body: JSON.stringify({ expectedVersion: record.versionId })
		});
	} catch (cause) {
		if (!(cause instanceof StorageError && cause.status === 404)) throw cause;
	}
	await deleteCreationLocal(id, database.local);
}
export async function addCreation(value: ExportedFuiz, database: Database): Promise<CreationId> {
	await verifyAccount(database);
	const internal = await internalizeFuiz(value, database);
	const { record }: { record: InternalFuiz } = await (
		await accountRequest(database, '/api/creations', {
			method: 'POST',
			body: JSON.stringify(internal)
		})
	).json();
	const id = await addCreationLocal(record, database.local);
	await optionalSync(database, () => database.remote?.create(record.uniqueId, record));
	return id;
}
export async function updateCreation(
	id: CreationId,
	value: ExportedFuiz,
	database: Database
): Promise<void> {
	await verifyAccount(database);
	const old = await getCreationLocal(id, database.local);
	if (!old || old.uniqueId !== value.uniqueId) throw new StorageError(404);
	const internal = await internalizeFuiz(value, database);
	const { record }: { record: InternalFuiz } = await (
		await accountRequest(database, `/api/creations/${value.uniqueId}`, {
			method: 'PUT',
			body: JSON.stringify({ expectedVersion: value.versionId - 1, record: internal })
		})
	).json();
	await updateCreationLocal(id, record, database.local);
	await optionalSync(database, () => database.remote?.update(record.uniqueId, record));
}
export async function findCreationByUniqueId(
	uniqueId: string,
	database: Database
): Promise<{ id: CreationId; versionId: number } | undefined> {
	const found = (await refreshCreations(database)).find(([, value]) => value.uniqueId === uniqueId);
	return found ? { id: found[0], versionId: found[1].versionId } : undefined;
}
export async function syncRemoteReports(database: Database): Promise<void> {
	const rows = await refreshReports(database);
	await optionalSync(database, () => database.remote?.syncReports(database.local, rows));
}
export async function getLocalReports(database: Database): Promise<[ReportId, InternalReport][]> {
	return toSorted(await refreshReports(database), ([, a], [, b]) => b.playedAt - a.playedAt);
}
export const getAllReports = getLocalReports;
export async function getReport(
	id: ReportId,
	database: Database
): Promise<InternalReport | undefined> {
	await verifyAccount(database);
	const alias = await getReportLocal(id, database.local);
	if (!alias) return undefined;
	try {
		const { record }: { record: InternalReport } = await (
			await accountRequest(database, `/api/reports/${alias.uniqueId}`)
		).json();
		await updateReportLocal(id, record, database.local);
		return record;
	} catch (cause) {
		if (cause instanceof StorageError && cause.status === 404) {
			await deleteReportLocal(id, database.local);
			return undefined;
		}
		throw cause;
	}
}
function plainCopy<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
const pendingReports = new WeakMap<ReportBody, InternalReport>();
export async function addReport(body: ReportBody, database: Database): Promise<ReportId> {
	await verifyAccount(database);
	let pending = pendingReports.get(body);
	if (!pending) {
		pending = plainCopy({
			...body,
			uniqueId: generateUuid(),
			versionId: 0,
			lastEdited: Date.now()
		});
		pendingReports.set(body, pending);
	}
	const { record }: { record: InternalReport } = await (
		await accountRequest(database, '/api/reports', {
			method: 'POST',
			body: JSON.stringify(pending)
		})
	).json();
	const id = await addReportLocal(record, database.local);
	await optionalSync(database, () => database.remote?.createReport(record.uniqueId, record));
	return id;
}
const pendingReportUpdates = new WeakMap<InternalReport, InternalReport>();
export async function updateReport(
	id: ReportId,
	value: InternalReport,
	database: Database
): Promise<InternalReport> {
	await verifyAccount(database);
	const old = await getReportLocal(id, database.local);
	if (!old || old.uniqueId !== value.uniqueId) throw new StorageError(404);
	let updated = pendingReportUpdates.get(value);
	if (!updated) {
		updated = plainCopy({ ...value, versionId: value.versionId + 1, lastEdited: Date.now() });
		pendingReportUpdates.set(value, updated);
	}
	const { record }: { record: InternalReport } = await (
		await accountRequest(database, `/api/reports/${value.uniqueId}`, {
			method: 'PUT',
			body: JSON.stringify({ expectedVersion: value.versionId, record: updated })
		})
	).json();
	await updateReportLocal(id, record, database.local);
	await optionalSync(database, () => database.remote?.updateReport(record.uniqueId, record));
	return record;
}
export async function deleteReport(id: ReportId, database: Database): Promise<void> {
	await verifyAccount(database);
	const record = await getReportLocal(id, database.local);
	if (!record) return;
	await optionalSync(database, () => database.remote?.deleteReport(record.uniqueId));
	try {
		await accountRequest(database, `/api/reports/${record.uniqueId}`, {
			method: 'DELETE',
			body: JSON.stringify({ expectedVersion: record.versionId })
		});
	} catch (cause) {
		if (!(cause instanceof StorageError && cause.status === 404)) throw cause;
	}
	await deleteReportLocal(id, database.local);
}
