import assert from 'node:assert/strict';
import type { BaseBlobStorage } from '../src/lib/blob/base';
import type { Account } from '../src/lib/server/accounts';
import type { PrivateResourceStore } from '../src/lib/server/privateResources';
import { privateRecordBytes } from './privateResourceSizeFixtures';
import { png } from './privateStoreChecks';

export async function exercisePrivateFailures(
	make: (blob: BaseBlobStorage) => PrivateResourceStore,
	blob: BaseBlobStorage,
	query: (sql: string, params?: (string | number | null)[]) => Promise<any[]>
) {
	const actor: Account = {
		id: crypto.randomUUID(),
		email: `${crypto.randomUUID()}@test.example`,
		role: 'ADMIN',
		sessionVersion: 0,
		createdAt: '2020-01-01',
		deletedAt: null
	};
	const target = {
		...actor,
		id: crypto.randomUUID(),
		email: `${crypto.randomUUID()}@test.example`,
		role: 'TEACHER' as const
	};
	for (const a of [actor, target])
		await query('INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,?,?)', [
			a.id,
			a.email,
			'original',
			a.role
		]);
	const store = make(blob);
	await store.putMedia(actor, 'intact', png);
	const failed = make({
		get: (key) => blob.get(key),
		delete: (key) => blob.delete(key),
		put: async () => {
			throw new Error('simulated upload failure');
		}
	});
	// A retry must not rewrite an already acknowledged blob.
	assert.equal((await failed.putMedia(actor, 'intact', png)).hash, 'intact');
	const record = {
		uniqueId: crypto.randomUUID(),
		versionId: 0,
		lastEdited: 1,
		config: {
			title: '',
			slides: [
				{
					InfoSlide: {
						title: '',
						media: { Image: { HashReference: { hash: 'missing', alt: '' } } }
					}
				}
			]
		}
	};
	const input = {
		confirmed: true,
		targetId: target.id,
		sourceKind: 'IndexedDB',
		records: [{ kind: 'creation', sourceId: record.uniqueId, record, copy: false }],
		media: [{ id: 'missing', media: png }]
	};
	const oversized = privateRecordBytes('creation', 1_900_001);
	await assert.rejects(
		failed.import(actor, {
			...input,
			records: [{ kind: 'creation', sourceId: oversized.uniqueId, record: oversized, copy: false }]
		}),
		{ status: 413 }
	);
	await assert.rejects(failed.import(actor, input));
	assert.equal(
		(await query('SELECT unique_id FROM host_resources WHERE owner_id=?', [target.id])).length,
		0
	);
	assert.equal(
		(await query('SELECT hash FROM host_media WHERE owner_id=?', [target.id])).length,
		0
	);
	let once = false;
	const revokeDuringUpload = make({
		get: (key) => blob.get(key),
		delete: (key) => blob.delete(key),
		put: async (key, value) => {
			await blob.put(key, value);
			if (!once) {
				once = true;
				await query('UPDATE admins SET session_version=session_version+1 WHERE id=?', [actor.id]);
			}
		}
	});
	await assert.rejects(revokeDuringUpload.import(actor, input), { status: 403 });
	assert.equal(
		(await query('SELECT unique_id FROM host_resources WHERE owner_id=?', [target.id])).length,
		0
	);
	assert.equal(
		(await query('SELECT hash FROM host_media WHERE owner_id=?', [target.id])).length,
		0
	);
	actor.sessionVersion = 1;
	const targetDeletedDuringUpload = make({
		get: (key) => blob.get(key),
		delete: (key) => blob.delete(key),
		put: async (key, value) => {
			await blob.put(key, value);
			await query('UPDATE admins SET deleted_at=CURRENT_TIMESTAMP,session_version=1 WHERE id=?', [
				target.id
			]);
		}
	});
	await assert.rejects(targetDeletedDuringUpload.import(actor, input), { status: 409 });
	assert.equal(
		(await query('SELECT unique_id FROM host_resources WHERE owner_id=?', [target.id])).length,
		0
	);
	assert.equal(
		(await query('SELECT hash FROM host_media WHERE owner_id=?', [target.id])).length,
		0
	);
}
