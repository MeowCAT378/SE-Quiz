import assert from 'node:assert/strict';
import type { BaseHostGameStore, NewHostGame } from '../src/lib/server/hostGames';

export async function exerciseHostStore(
	store: BaseHostGameStore,
	query: (sql: string, params?: (string | number)[]) => Promise<unknown[]>
) {
	const owner = crypto.randomUUID(),
		other = crypto.randomUUID(),
		uniqueId = crypto.randomUUID();
	await query(
		"INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,'preserved-hash','ADMIN'), (?,?,'other-hash','TEACHER')",
		[owner, 'owner@example.test', other, 'other@example.test']
	);
	const origin = { uniqueId, versionId: 3 };
	await query(
		"INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (?,'creation',?,3,?)",
		[
			owner,
			uniqueId,
			JSON.stringify({ ...origin, lastEdited: 111, config: { title: 'original', slides: [] } })
		]
	);
	assert.equal(await store.ownsOrigin(owner, origin), true);
	assert.equal(await store.ownsOrigin(other, origin), false);
	assert.equal(await store.ownsOrigin(owner, { ...origin, versionId: 4 }), false);
	const game: NewHostGame = {
		instanceId: crypto.randomUUID(),
		code: '12345',
		ownerId: owner,
		hostWatcherId: crypto.randomUUID(),
		originUniqueId: uniqueId,
		originVersionId: 3
	};
	await store.record(game, 0);
	assert.deepEqual(await store.listed(), [{ quiz_id: uniqueId, game_code: '12345' }]);
	assert.equal((await store.current('12345'))?.ownerId, owner);
	assert.equal(await store.setListed(other, 0, game.instanceId, false), false);
	assert.equal(await store.setListed(owner, 0, game.instanceId, false), true);
	assert.deepEqual(await store.listed(), []);
	assert.equal((await store.current('12345'))?.instanceId, game.instanceId);
	await assert.rejects(
		store.record({ ...game, instanceId: crypto.randomUUID(), ownerId: other }, 0)
	);
	assert.equal((await store.current('12345'))?.instanceId, game.instanceId);
	await query('UPDATE admins SET session_version=1 WHERE id=?', [owner]);
	await assert.rejects(store.record({ ...game, instanceId: crypto.randomUUID() }, 0));
	assert.equal(await store.setListed(owner, 0, game.instanceId, true), false);
	assert.equal((await store.current('12345'))?.instanceId, game.instanceId);
	const next = { ...game, instanceId: crypto.randomUUID(), hostWatcherId: crypto.randomUUID() };
	await store.record(next, 1);
	assert.equal((await store.current('12345'))?.instanceId, next.instanceId);
	// A late completion for a reused code cannot end its replacement instance.
	assert.equal(await store.complete(game.instanceId, game.code, owner, game.hostWatcherId), true);
	assert.equal((await store.current(next.code))?.instanceId, next.instanceId);
	for (const binding of [
		[next.instanceId, '99999', owner, next.hostWatcherId],
		[next.instanceId, next.code, other, next.hostWatcherId],
		[next.instanceId, next.code, owner, game.hostWatcherId]
	])
		assert.equal(await store.complete(binding[0], binding[1], binding[2], binding[3]), false);
	assert.equal((await store.current(next.code))?.instanceId, next.instanceId);
	for (let attempt = 0; attempt < 2; attempt++) {
		assert.equal(await store.complete(next.instanceId, next.code, owner, next.hostWatcherId), true);
	}
	assert.equal(await store.current(next.code), null);
	assert.deepEqual(await store.listed(), []);
	// Both adapters must persist the discovery choice in the original insert.
	for (const listed of [false, true]) {
		const room = {
			...next,
			instanceId: crypto.randomUUID(),
			code: '23456',
			listed,
			originUniqueId: null,
			originVersionId: null
		};
		await store.record(room, 1);
		assert.equal(
			(await store.listed()).some((row) => row.game_code === room.code),
			listed
		);
		assert.equal(
			Number(
				(await query('SELECT listed FROM host_games WHERE instance_id=?', [room.instanceId])).map(
					(row) => (row as { listed: number }).listed
				)[0]
			),
			listed ? 1 : 0
		);
	}
	assert.equal(await store.setListed(owner, 1, game.instanceId, true), false);
	assert.equal((await query('SELECT instance_id FROM host_games')).length, 4);
	await query('UPDATE host_resources SET body=? WHERE owner_id=?', [
		JSON.stringify({ ...origin, versionId: 99 }),
		owner
	]);
	assert.equal(await store.ownsOrigin(owner, origin), false);
	await assert.rejects(store.record({ ...game, instanceId: crypto.randomUUID() }, 1));
	await assert.rejects(
		store.record(
			{
				...game,
				instanceId: crypto.randomUUID(),
				code: '123456',
				originUniqueId: null,
				originVersionId: null
			},
			1
		)
	);
	await query("INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,'preserved','ADMIN')", [
		crypto.randomUUID(),
		'survivor@example.test'
	]);
	await query('UPDATE admins SET deleted_at=CURRENT_TIMESTAMP,session_version=2 WHERE id=?', [
		owner
	]);
	await assert.rejects(store.record({ ...next, instanceId: crypto.randomUUID() }, 2));
	assert.equal((await query('SELECT instance_id FROM host_games')).length, 4);
	assert.equal((await query('SELECT body FROM host_resources')).length, 1);
}
