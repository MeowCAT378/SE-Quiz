import type { BaseBlobStorage } from '../blob/base';
import type { InternalReport } from '../storage';
import type { Account } from './accounts';
import { isUuid } from './hostGames';
import {
	canonical,
	digest,
	finiteJson,
	integer,
	isMediaHash,
	object,
	type PrivateRecord,
	ResourceError,
	type ResourceKind,
	valid,
	validateMedia,
	validateRecord
} from './privateValidation';

export type ResourceAck = { record: PrivateRecord; createdAt: string; updatedAt: string };
export type ImportAck = {
	uniqueId: string;
	kind: ResourceKind;
	sourceKind: string;
	sourceId: string;
	importedAt: string;
};
export type Statement = { sql: string; params: (string | number | null)[] };
export type Row = Record<string, any>;
type ImportContext = {
	ownerId: string;
	sourceKind: string;
	sourceId: string;
	contentDigest: string;
	copy: boolean;
};
const statement = (sql: string, ...params: Statement['params']): Statement => ({ sql, params });
const ack = (row: Row): ResourceAck => ({
	record: JSON.parse(row.body),
	createdAt: new Date(row.created_at).toISOString(),
	updatedAt: new Date(row.updated_at).toISOString()
});
const authSql =
	"EXISTS (SELECT 1 FROM admins WHERE id=? AND session_version=? AND deleted_at IS NULL AND role IN ('ADMIN','TEACHER'))";

/** Shared SQL predicates keep PostgreSQL and D1 ownership and CAS behavior identical. */
export abstract class PrivateResourceStore {
	constructor(protected blob?: BaseBlobStorage) {}
	protected abstract query(query: Statement): Promise<Row[]>;
	protected abstract readonly jsonValues: string;
	/** D1 executes one atomic batch. PostgreSQL additionally locks current actor/target rows. */
	protected abstract atomic(
		actor: Account,
		ownerId: string,
		statements: Statement[]
	): Promise<Row[][]>;
	private authority(actor: Account, ownerId = actor.id, importing = false): Statement {
		valid(isUuid(actor.id) && isUuid(ownerId));
		integer(actor.sessionVersion);
		return statement(
			`${authSql}${importing ? " AND EXISTS (SELECT 1 FROM admins WHERE id=? AND role='ADMIN') AND EXISTS (SELECT 1 FROM admins WHERE id=? AND deleted_at IS NULL AND role IN ('ADMIN','TEACHER'))" : ''}`,
			actor.id,
			actor.sessionVersion,
			...(importing ? [actor.id, ownerId] : [])
		);
	}
	private async current(actor: Account, ownerId = actor.id, importing = false) {
		const auth = this.authority(actor, ownerId, importing);
		if (
			!(
				await this.query(
					statement(`SELECT id FROM admins WHERE id=? AND ${auth.sql}`, actor.id, ...auth.params)
				)
			).length
		) {
			const normal = this.authority(actor);
			if (
				!(
					await this.query(
						statement(
							`SELECT id FROM admins WHERE id=? AND ${normal.sql}`,
							actor.id,
							...normal.params
						)
					)
				).length
			)
				throw new ResourceError(403, 'Current account required');
			if (
				importing &&
				!(
					await this.query(statement("SELECT id FROM admins WHERE id=? AND role='ADMIN'", actor.id))
				).length
			)
				throw new ResourceError(403, 'Administrator access required');
			throw new ResourceError(409, 'Active import target required');
		}
	}
	async get(actor: Account, kind: ResourceKind, uuid: string): Promise<ResourceAck | null> {
		valid(isUuid(uuid));
		valid(kind === 'creation' || kind === 'report');
		await this.current(actor);
		const auth = this.authority(actor);
		const [row] = await this.query(
			statement(
				`SELECT * FROM host_resources WHERE owner_id=? AND kind=? AND unique_id=? AND ${auth.sql}`,
				actor.id,
				kind,
				uuid,
				...auth.params
			)
		);
		return row ? ack(row) : null;
	}
	async gameForExport(actor: Account, instanceId: string) {
		valid(isUuid(instanceId));
		await this.current(actor);
		const auth = this.authority(actor);
		const [row] = await this.query(
			statement(
				`SELECT instance_id,code,origin_unique_id,origin_version_id FROM host_games WHERE owner_id=? AND instance_id=? AND ${auth.sql}`,
				actor.id,
				instanceId,
				...auth.params
			)
		);
		return row
			? {
					gameInstanceId: row.instance_id,
					gameCode: row.code,
					fuizUniqueId: row.origin_unique_id ?? undefined,
					fuizVersionId: row.origin_version_id === null ? undefined : Number(row.origin_version_id)
				}
			: null;
	}
	async list(actor: Account, kind: ResourceKind): Promise<ResourceAck[]> {
		valid(kind === 'creation' || kind === 'report');
		await this.current(actor);
		const auth = this.authority(actor);
		return (
			await this.query(
				statement(
					`SELECT * FROM host_resources WHERE owner_id=? AND kind=? AND ${auth.sql} ORDER BY updated_at DESC,unique_id`,
					actor.id,
					kind,
					...auth.params
				)
			)
		).map(ack);
	}
	async write(
		actor: Account,
		kind: ResourceKind,
		input: unknown,
		expectedVersion: number | null
	): Promise<ResourceAck> {
		return this.writeFor(actor, kind, input, expectedVersion);
	}
	private async writeFor(
		actor: Account,
		kind: ResourceKind,
		input: unknown,
		expectedVersion: number | null,
		importing?: ImportContext
	): Promise<ResourceAck> {
		const { record, hashes } = validateRecord(kind, input);
		if (expectedVersion !== null) {
			integer(expectedVersion);
			valid(record.versionId > expectedVersion, 'New version must advance');
		}
		const owner = importing?.ownerId ?? actor.id;
		await this.current(actor, owner, !!importing);
		const [stored] = await this.query(
			statement(
				'SELECT body FROM host_resources WHERE owner_id=? AND kind=? AND unique_id=?',
				owner,
				kind,
				record.uniqueId
			)
		);
		const body = canonical(record);
		// An exact retry after a lost acknowledgement may reuse the committed version. Preserve
		// its stored JSON spelling so SQL equality also works for older, noncanonical records.
		const retryBody =
			stored && canonical(JSON.parse(stored.body)) === body ? (stored.body as string) : body;
		const auth = this.authority(actor, owner, !!importing);
		const conditions = [auth.sql];
		const params = [...auth.params];
		if (hashes.length) {
			conditions.push(
				`(SELECT COUNT(*) FROM host_media WHERE owner_id=? AND hash IN (${this.jsonValues}))=?`
			);
			params.push(owner, JSON.stringify(hashes), hashes.length);
		}
		if (kind === 'report') {
			const report = record as InternalReport;
			if (report.gameInstanceId) {
				conditions.push(
					'EXISTS (SELECT 1 FROM host_games WHERE owner_id=? AND instance_id=? AND code=? AND ((origin_unique_id=? AND origin_version_id=?) OR (origin_unique_id IS NULL AND CAST(? AS TEXT) IS NULL AND origin_version_id IS NULL AND CAST(? AS BIGINT) IS NULL)))'
				);
				params.push(
					owner,
					report.gameInstanceId,
					report.gameCode ?? '',
					report.fuizUniqueId ?? null,
					report.fuizVersionId ?? null,
					report.fuizUniqueId ?? null,
					report.fuizVersionId ?? null
				);
			} else if (!importing) {
				valid(expectedVersion !== null, 'New reports require a verified game instance');
				// Imported historical reports remain editable, but updates cannot replace their origin fields.
				if (!stored) throw new ResourceError(404, 'Private record not found');
				const old = JSON.parse(stored.body) as InternalReport;
				valid(
					!old.gameInstanceId &&
						old.gameCode === report.gameCode &&
						old.fuizUniqueId === report.fuizUniqueId &&
						old.fuizVersionId === report.fuizVersionId,
					'Report origin is immutable'
				);
				conditions.push(
					'EXISTS (SELECT 1 FROM host_resources WHERE owner_id=? AND kind=? AND unique_id=? AND body=?)'
				);
				params.push(owner, kind, record.uniqueId, stored.body);
			}
		}
		const where = conditions.join(' AND ');
		let write: Statement;
		if (expectedVersion === null) {
			write = statement(
				`INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) SELECT ?,?,?,?,? WHERE ${where} ON CONFLICT(owner_id,kind,unique_id) DO UPDATE SET body=host_resources.body WHERE (host_resources.body=excluded.body OR host_resources.body=?) AND host_resources.version_id=excluded.version_id RETURNING *`,
				owner,
				kind,
				record.uniqueId,
				record.versionId,
				body,
				...params,
				retryBody
			);
		} else {
			write = statement(
				`UPDATE host_resources SET version_id=?,body=?,updated_at=CASE WHEN body=? THEN updated_at ELSE CURRENT_TIMESTAMP END WHERE owner_id=? AND kind=? AND unique_id=? AND (version_id=? OR (version_id=? AND body=?)) AND ${where} RETURNING *`,
				record.versionId,
				body,
				retryBody,
				owner,
				kind,
				record.uniqueId,
				expectedVersion,
				record.versionId,
				retryBody,
				...params
			);
		}
		const batch = [write];
		if (importing) {
			batch.push(
				statement(
					`INSERT INTO host_imports(owner_id,kind,source_kind,source_id,content_digest,copy,unique_id,actor_id) SELECT ?,?,?,?,?,?,?,? WHERE ${where} AND EXISTS (SELECT 1 FROM host_resources WHERE owner_id=? AND kind=? AND unique_id=? AND (body=? OR body=?)) ON CONFLICT(owner_id,kind,source_kind,source_id,content_digest,copy) DO NOTHING RETURNING unique_id`,
					owner,
					kind,
					importing.sourceKind,
					importing.sourceId,
					importing.contentDigest,
					importing.copy ? 1 : 0,
					record.uniqueId,
					actor.id,
					...params,
					owner,
					kind,
					record.uniqueId,
					body,
					retryBody
				)
			);
		}
		let rows: Row[];
		try {
			[rows] = await this.atomic(actor, owner, batch);
		} catch (cause) {
			if (
				importing &&
				(String(cause).includes('UNIQUE constraint failed: host_imports.') ||
					(cause as { errno?: string }).errno === '23505')
			)
				throw new ResourceError(409, 'Source import conflict');
			throw cause;
		}
		if (rows[0]) return ack(rows[0]);
		await this.current(actor, owner, !!importing);
		if (
			expectedVersion !== null &&
			!(
				await this.query(
					statement(
						'SELECT unique_id FROM host_resources WHERE owner_id=? AND kind=? AND unique_id=?',
						owner,
						kind,
						record.uniqueId
					)
				)
			).length
		)
			throw new ResourceError(404, 'Private record not found');
		throw new ResourceError(409, 'Version, media or game binding conflict');
	}
	async remove(
		actor: Account,
		kind: ResourceKind,
		uuid: string,
		expectedVersion: number
	): Promise<void> {
		valid(isUuid(uuid));
		valid(kind === 'creation' || kind === 'report');
		integer(expectedVersion);
		await this.current(actor);
		const auth = this.authority(actor);
		const [rows] = await this.atomic(actor, actor.id, [
			statement(
				`DELETE FROM host_resources WHERE owner_id=? AND kind=? AND unique_id=? AND version_id=? AND ${auth.sql} RETURNING unique_id`,
				actor.id,
				kind,
				uuid,
				expectedVersion,
				...auth.params
			)
		]);
		if (rows.length) return;
		await this.current(actor);
		if (!(await this.get(actor, kind, uuid)))
			throw new ResourceError(404, 'Private record not found');
		throw new ResourceError(409, 'Version conflict');
	}
	async putMedia(actor: Account, hash: string, value: unknown) {
		return this.putMediaFor(actor, actor.id, hash, value, false);
	}
	private async putMediaFor(
		actor: Account,
		owner: string,
		hash: string,
		value: unknown,
		importing: boolean
	) {
		const checked = validateMedia(hash, value);
		await this.current(actor, owner, importing);
		if (!this.blob) throw new ResourceError(503, 'Private media unavailable');
		const auth = this.authority(actor, owner, importing);
		const [existing] = await this.query(
			statement(
				'SELECT content_digest,blob_key FROM host_media WHERE owner_id=? AND hash=?',
				owner,
				hash
			)
		);
		if (existing && existing.content_digest !== checked.contentDigest)
			throw new ResourceError(409, 'Media identifier already has different content');
		if (existing) {
			const saved = await this.blob.get(existing.blob_key);
			if (!saved || validateMedia(hash, JSON.parse(saved)).contentDigest !== checked.contentDigest)
				throw new ResourceError(503, 'Private media unavailable');
			await this.current(actor, owner, importing);
			return {
				hash,
				contentDigest: checked.contentDigest,
				mime: checked.mime,
				byteSize: checked.byteSize
			};
		}
		// Each attempt uses a new flat key: concurrent/failed puts cannot truncate an acknowledged blob.
		const key = `private-${owner}-${checked.contentDigest}-${crypto.randomUUID()}`;
		// Blob and SQL writes are not one transaction: failure can leave an unreferenced blob,
		// but ownership is acknowledged only after the guarded metadata write succeeds.
		await this.blob.put(key, canonical(checked.media));
		const [rows] = await this.atomic(actor, owner, [
			statement(
				`INSERT INTO host_media(owner_id,hash,content_digest,blob_key,mime,byte_size) SELECT ?,?,?,?,?,? WHERE ${auth.sql} ON CONFLICT(owner_id,hash) DO UPDATE SET hash=excluded.hash WHERE host_media.content_digest=excluded.content_digest RETURNING hash,content_digest,mime,byte_size`,
				owner,
				hash,
				checked.contentDigest,
				key,
				checked.mime,
				checked.byteSize,
				...auth.params
			)
		]);
		if (!rows.length) {
			await this.current(actor, owner, importing);
			throw new ResourceError(409, 'Media identifier already has different content');
		}
		return {
			hash,
			contentDigest: checked.contentDigest,
			mime: checked.mime,
			byteSize: checked.byteSize
		};
	}
	async getMedia(actor: Account, hash: string) {
		valid(isMediaHash(hash));
		await this.current(actor);
		const auth = this.authority(actor);
		const [row] = await this.query(
			statement(
				`SELECT blob_key,content_digest FROM host_media WHERE owner_id=? AND hash=? AND ${auth.sql}`,
				actor.id,
				hash,
				...auth.params
			)
		);
		if (!row) return null;
		if (!this.blob) throw new ResourceError(503, 'Private media unavailable');
		const value = await this.blob.get(row.blob_key);
		if (!value) throw new ResourceError(503, 'Private media unavailable');
		const checked = validateMedia(hash, JSON.parse(value));
		if (checked.contentDigest !== row.content_digest)
			throw new ResourceError(503, 'Private media unavailable');
		await this.current(actor);
		return checked.media;
	}
	async import(actor: Account, input: unknown): Promise<ImportAck[]> {
		finiteJson(input, 32 * 1024 * 1024);
		const request = object(input, ['sourceKind', 'targetId', 'confirmed', 'records', 'media']);
		valid(request.sourceKind === 'IndexedDB' || request.sourceKind === 'legacyGoogleDrive');
		valid(isUuid(request.targetId));
		valid(request.confirmed === true);
		valid(
			Array.isArray(request.records) && request.records.length > 0 && request.records.length <= 100
		);
		valid(Array.isArray(request.media) && request.media.length <= 100);
		await this.current(actor, request.targetId, true);
		// Validate the complete selection before writing media. Each resource/provenance pair commits atomically.
		const records = request.records.map((entry) => {
			const item = object(entry, ['kind', 'sourceId', 'record', 'copy']);
			valid(item.kind === 'creation' || item.kind === 'report');
			valid(
				typeof item.sourceId === 'string' && item.sourceId.length > 0 && item.sourceId.length <= 512
			);
			valid(typeof item.copy === 'boolean');
			finiteJson(item.record);
			valid(item.record && typeof item.record === 'object' && !Array.isArray(item.record));
			const original = item.record as Record<string, unknown>;
			if (original.uniqueId !== undefined)
				valid(
					isUuid(original.uniqueId) && original.uniqueId === item.sourceId,
					'Source identifier must match record UUID'
				);
			const contentDigest = digest(canonical(original));
			const seed = digest(
				canonical([
					request.targetId,
					item.kind,
					request.sourceKind,
					item.sourceId,
					contentDigest,
					item.copy
				])
			);
			const uuid = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
			const record = {
				...original,
				uniqueId: item.copy || original.uniqueId === undefined ? uuid : original.uniqueId,
				versionId: original.versionId ?? 0
			};
			validateRecord(item.kind, record);
			return {
				kind: item.kind as ResourceKind,
				record,
				context: {
					ownerId: request.targetId as string,
					sourceKind: request.sourceKind as string,
					sourceId: item.sourceId,
					contentDigest,
					copy: item.copy
				}
			};
		});
		const media = request.media.map((entry) => {
			const item = object(entry, ['id', 'media']);
			valid(isMediaHash(item.id));
			validateMedia(item.id, item.media);
			return item;
		});
		for (const item of media)
			await this.putMediaFor(actor, request.targetId, item.id as string, item.media, true);
		const results: ImportAck[] = [];
		for (const item of records) {
			await this.current(actor, request.targetId, true);
			const c = item.context;
			const auth = this.authority(actor, request.targetId, true);
			const receiptQuery = statement(
				`SELECT i.unique_id,i.imported_at,r.unique_id AS present FROM host_imports i LEFT JOIN host_resources r ON r.owner_id=i.owner_id AND r.kind=i.kind AND r.unique_id=i.unique_id WHERE i.owner_id=? AND i.kind=? AND i.source_kind=? AND i.source_id=? AND i.content_digest=? AND i.copy=? AND ${auth.sql}`,
				request.targetId,
				item.kind,
				c.sourceKind,
				c.sourceId,
				c.contentDigest,
				c.copy ? 1 : 0,
				...auth.params
			);
			let [receipt] = await this.query(receiptQuery);
			if (receipt && !receipt.present) throw new ResourceError(409, 'Imported record was deleted');
			if (!receipt) {
				await this.writeFor(actor, item.kind, item.record, null, c);
				[receipt] = await this.query(receiptQuery);
				if (!receipt) {
					await this.current(actor, request.targetId, true);
					throw new ResourceError(409, 'Import outcome unavailable');
				}
			}
			// A receipt never exposes private edits the target owner made after the import.
			results.push({
				uniqueId: receipt.unique_id,
				kind: item.kind,
				sourceKind: c.sourceKind,
				sourceId: c.sourceId,
				importedAt: new Date(receipt.imported_at).toISOString()
			});
		}
		return results;
	}
}
