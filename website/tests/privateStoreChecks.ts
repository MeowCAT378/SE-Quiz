import assert from 'node:assert/strict';
import type { Account } from '../src/lib/server/accounts';
import type { PrivateResourceStore } from '../src/lib/server/privateResources';
import type { InternalFuiz, InternalReport } from '../src/lib/storage';
import { privateRecordBytes } from './privateResourceSizeFixtures';

export const png = {
	Image: {
		Base64: {
			alt: '',
			data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
		}
	}
};

export async function exercisePrivateStore(
	store: PrivateResourceStore,
	query: (sql: string, params?: (string | number | null)[]) => Promise<any[]>
) {
	const account = (role: 'ADMIN' | 'TEACHER'): Account => ({
		id: crypto.randomUUID(),
		email: `${crypto.randomUUID()}@example.test`,
		role,
		createdAt: '2020-01-01T00:00:00Z',
		deletedAt: null,
		sessionVersion: 0
	});
	const admin = account('ADMIN'),
		teacher = account('TEACHER'),
		other = account('TEACHER');
	for (const a of [admin, teacher, other])
		await query('INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,?,?)', [
			a.id,
			a.email,
			'unchanged-pbkdf2',
			a.role
		]);
	const creation: InternalFuiz = {
		uniqueId: crypto.randomUUID(),
		versionId: 0,
		lastEdited: 111,
		config: { title: '', slides: [] }
	};
	const written = await store.write(teacher, 'creation', creation, null);
	assert.deepEqual(written.record, creation);
	assert.deepEqual((await store.write(teacher, 'creation', creation, null)).record, creation);
	assert.equal(await store.get(other, 'creation', creation.uniqueId), null);
	assert.equal(await store.get(admin, 'creation', creation.uniqueId), null);
	assert.equal((await store.list(teacher, 'creation')).length, 1);
	assert.equal((await store.list(other, 'creation')).length, 0);
	const boundaryCreation = privateRecordBytes('creation', 1_900_000);
	assert.deepEqual(
		(await store.write(teacher, 'creation', boundaryCreation, null)).record,
		boundaryCreation
	);
	const boundaryReport = privateRecordBytes('report', 1_900_000);
	await store.import(admin, {
		sourceKind: 'IndexedDB',
		targetId: teacher.id,
		confirmed: true,
		records: [
			{ kind: 'report', sourceId: boundaryReport.uniqueId, record: boundaryReport, copy: false }
		],
		media: []
	});
	assert.deepEqual(
		(await store.get(teacher, 'report', boundaryReport.uniqueId))?.record,
		boundaryReport
	);
	for (const kind of ['creation', 'report'] as const)
		await assert.rejects(store.write(teacher, kind, privateRecordBytes(kind, 1_900_001), null), {
			status: 413
		});
	const untouched = { ...creation, uniqueId: crypto.randomUUID() };
	await assert.rejects(
		store.import(admin, {
			sourceKind: 'IndexedDB',
			targetId: teacher.id,
			confirmed: true,
			records: [
				{ kind: 'creation', sourceId: untouched.uniqueId, record: untouched, copy: false },
				{
					kind: 'report',
					sourceId: boundaryReport.uniqueId,
					record: privateRecordBytes('report', 1_900_001),
					copy: true
				}
			],
			media: [{ id: 'oversize-rejected', media: png }]
		}),
		{ status: 413 }
	);
	assert.equal(
		(
			await query('SELECT unique_id FROM host_resources WHERE owner_id=? AND unique_id=?', [
				teacher.id,
				untouched.uniqueId
			])
		).length,
		0
	);
	assert.equal(
		(
			await query('SELECT hash FROM host_media WHERE owner_id=? AND hash=?', [
				teacher.id,
				'oversize-rejected'
			])
		).length,
		0
	);
	await assert.rejects(store.write(teacher, 'creation', { ...creation, ownerId: other.id }, null), {
		status: 400
	});
	await assert.rejects(store.write(teacher, 'creation', { ...creation, lastEdited: 222 }, null), {
		status: 409
	});
	await assert.rejects(store.write(other, 'creation', { ...creation, versionId: 1 }, 0), {
		status: 404
	});
	await assert.rejects(store.remove(other, 'creation', creation.uniqueId, 0), { status: 404 });
	const v1 = { ...creation, versionId: 1, lastEdited: 222 };
	await store.write(teacher, 'creation', v1, 0);
	await store.write(teacher, 'creation', v1, 0);
	await assert.rejects(store.write(teacher, 'creation', { ...v1, versionId: 2 }, 0), {
		status: 409
	});
	const concurrent = await Promise.allSettled([
		store.write(teacher, 'creation', { ...v1, versionId: 2, lastEdited: 333 }, 1),
		store.write(teacher, 'creation', { ...v1, versionId: 2, lastEdited: 444 }, 1)
	]);
	assert.equal(concurrent.filter((r) => r.status === 'fulfilled').length, 1);
	const withMissingMedia = {
		...creation,
		uniqueId: crypto.randomUUID(),
		config: {
			title: 'image',
			slides: [
				{
					InfoSlide: {
						title: '',
						media: { Image: { HashReference: { hash: 'legacy-image', alt: '' } } }
					}
				}
			]
		}
	};
	await assert.rejects(store.write(teacher, 'creation', withMissingMedia, null), { status: 409 });
	const media = await store.putMedia(teacher, 'legacy-image', png);
	assert.equal(media.hash, 'legacy-image');
	assert.deepEqual(await store.getMedia(teacher, 'legacy-image'), {
		...png,
		Image: { Base64: { ...png.Image.Base64, hash: 'legacy-image' } }
	});
	assert.equal(await store.getMedia(other, 'legacy-image'), null);
	assert.equal(await store.getMedia(admin, 'legacy-image'), null);
	await store.putMedia(teacher, 'legacy-image', png);
	await assert.rejects(store.putMedia(teacher, '../escape', png), { status: 400 });
	await assert.rejects(
		store.putMedia(teacher, 'legacy-image', {
			Image: {
				Base64: {
					alt: '',
					data: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg=='
				}
			}
		}),
		{ status: 409 }
	);
	await store.write(teacher, 'creation', withMissingMedia, null);
	const oldOrdering = { ...creation, uniqueId: crypto.randomUUID() };
	await query(
		"INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (?,'creation',?,0,?)",
		[teacher.id, oldOrdering.uniqueId, JSON.stringify(oldOrdering)]
	);
	assert.deepEqual(
		(await store.write(teacher, 'creation', oldOrdering, null)).record,
		oldOrdering,
		'Semantic retries accept original JSON key order'
	);
	const largeSlides = Array.from({ length: 101 }, (_, n) => ({
		InfoSlide: { title: '', media: { Image: { HashReference: { hash: `bulk-${n}`, alt: '' } } } }
	}));
	for (let n = 0; n < 101; n++)
		await query(
			"INSERT INTO host_media(owner_id,hash,content_digest,blob_key,mime,byte_size) SELECT owner_id,?,content_digest,blob_key,mime,byte_size FROM host_media WHERE owner_id=? AND hash='legacy-image'",
			[`bulk-${n}`, teacher.id]
		);
	await store.write(
		teacher,
		'creation',
		{ ...creation, uniqueId: crypto.randomUUID(), config: { title: '', slides: largeSlides } },
		null
	);
	const instance = crypto.randomUUID();
	await query(
		'INSERT INTO host_games(instance_id,code,owner_id,host_watcher_id,origin_unique_id,origin_version_id,session_version) VALUES (?,?,?,?,?,?,0)',
		[instance, '12345', teacher.id, crypto.randomUUID(), withMissingMedia.uniqueId, 0]
	);
	const report: InternalReport = {
		uniqueId: crypto.randomUUID(),
		versionId: 0,
		lastEdited: 444,
		title: 'snapshot',
		playedAt: 333,
		gameInstanceId: instance,
		gameCode: '12345',
		fuizUniqueId: withMissingMedia.uniqueId,
		fuizVersionId: 0,
		playerCount: 0,
		questions: [],
		results: []
	};
	await store.write(teacher, 'report', report, null);
	await assert.rejects(
		store.write(other, 'report', { ...report, uniqueId: crypto.randomUUID() }, null),
		{ status: 409 }
	);
	await assert.rejects(
		store.write(
			teacher,
			'report',
			{ ...report, uniqueId: crypto.randomUUID(), gameInstanceId: crypto.randomUUID() },
			null
		),
		{ status: 409 }
	);
	await assert.rejects(
		store.write(
			teacher,
			'report',
			{ ...report, uniqueId: crypto.randomUUID(), fuizUniqueId: creation.uniqueId },
			null
		),
		{ status: 409 }
	);
	await query('UPDATE host_games SET ended_at=CURRENT_TIMESTAMP WHERE instance_id=?', [instance]);
	assert.deepEqual(await store.gameForExport(teacher, instance), {
		gameInstanceId: instance,
		gameCode: '12345',
		fuizUniqueId: withMissingMedia.uniqueId,
		fuizVersionId: 0
	});
	assert.equal(await store.gameForExport(other, instance), null);
	assert.equal(await store.gameForExport(admin, instance), null);
	await assert.rejects(store.gameForExport({ ...teacher, sessionVersion: 999 }, instance), {
		status: 403
	});
	await store.remove(teacher, 'creation', withMissingMedia.uniqueId, 0);
	await store.write(teacher, 'report', { ...report, versionId: 1 }, 0);
	assert.equal(
		(await query('SELECT instance_id FROM host_games WHERE instance_id=?', [instance])).length,
		1
	);
	const historical = { ...report, uniqueId: crypto.randomUUID() };
	delete historical.gameInstanceId;
	historical.gameCode = '123456';
	await assert.rejects(store.write(teacher, 'report', historical, null), { status: 400 });
	const selection = {
		sourceKind: 'IndexedDB' as const,
		targetId: other.id,
		confirmed: true as const,
		records: [
			{ kind: 'report' as const, sourceId: historical.uniqueId, record: historical, copy: false }
		],
		media: []
	};
	await assert.rejects(store.import(teacher, selection), { status: 403 });
	const imported = await store.import(admin, selection);
	assert.equal(imported[0].uniqueId, historical.uniqueId);
	assert.deepEqual((await store.get(other, 'report', historical.uniqueId))?.record, historical);
	assert.equal('record' in imported[0], false);
	assert.deepEqual((await store.import(admin, selection))[0], imported[0]);
	await store.write(
		other,
		'report',
		{ ...historical, versionId: 1, title: 'editable historical' },
		0
	);
	// A retry identifies the original import outcome even after the target edits it.
	assert.deepEqual((await store.import(admin, selection))[0], imported[0]);
	const changed = {
		...selection,
		records: [{ ...selection.records[0], record: { ...historical, title: 'different source' } }]
	};
	await assert.rejects(store.import(admin, changed), { status: 409 });
	const copied = { ...changed, records: [{ ...changed.records[0], copy: true }] };
	const copy = await store.import(admin, copied);
	assert.notEqual(copy[0].uniqueId, historical.uniqueId);
	assert.equal((await store.import(admin, copied))[0].uniqueId, copy[0].uniqueId);
	assert.equal(
		(await query('SELECT source_id FROM host_imports WHERE owner_id=?', [other.id])).length,
		2
	);
	await store.remove(other, 'report', copy[0].uniqueId, historical.versionId);
	await assert.rejects(
		store.import(admin, copied),
		{ status: 409 },
		'Retry must not recreate an imported copy deliberately deleted by its owner'
	);
	const raw = { lastEdited: 1, config: { title: 'legacy raw', slides: [] } };
	const rawSelection = {
		...selection,
		records: [{ kind: 'creation' as const, sourceId: '42', record: raw, copy: false }]
	};
	const rawCopy = await store.import(admin, rawSelection);
	assert.equal((await store.import(admin, rawSelection))[0].uniqueId, rawCopy[0].uniqueId);
	assert.deepEqual(raw, { lastEdited: 1, config: { title: 'legacy raw', slides: [] } });
	const competing = await Promise.allSettled(
		[0, 1].map((n) =>
			store.import(admin, {
				...rawSelection,
				records: [
					{
						...rawSelection.records[0],
						sourceId: 'concurrent-legacy',
						record: { ...raw, config: { title: `variant ${n}`, slides: [] } }
					}
				]
			})
		)
	);
	assert.equal(
		competing.filter((r) => r.status === 'fulfilled').length,
		1,
		'A concurrent changed source must conflict, including raw records without UUIDs'
	);
	await query('UPDATE admins SET session_version=1 WHERE id=?', [teacher.id]);
	await assert.rejects(store.get(teacher, 'report', report.uniqueId), { status: 403 });
	await assert.rejects(
		store.write(teacher, 'creation', { ...creation, uniqueId: crypto.randomUUID() }, null),
		{ status: 403 }
	);
	await assert.rejects(store.putMedia(teacher, 'denied', png), { status: 403 });
	await query('UPDATE admins SET deleted_at=CURRENT_TIMESTAMP,session_version=1 WHERE id=?', [
		other.id
	]);
	await assert.rejects(
		store.import(admin, { ...selection, records: [{ ...selection.records[0], copy: true }] }),
		{ status: 409 }
	);
	await assert.rejects(store.list(other, 'report'), { status: 403 });
	assert.ok(
		(await query('SELECT body FROM host_resources WHERE owner_id=?', [other.id])).length >= 3
	);
	await query('UPDATE admins SET session_version=1 WHERE id=?', [admin.id]);
	await assert.rejects(store.import(admin, { ...selection, targetId: teacher.id }), {
		status: 403
	});
}
