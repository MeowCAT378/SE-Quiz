import assert from 'node:assert/strict';

export async function exercisePrivateUpgrade(
	query: (sql: string, params?: (string | number | null)[]) => Promise<any[]>,
	apply: () => Promise<void>
) {
	const owner = crypto.randomUUID(),
		uuid = crypto.randomUUID();
	await query(
		"INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,'pbkdf2-sha256$600000$original$unchanged','ADMIN')",
		[owner, `${owner}@example.test`]
	);
	const body = JSON.stringify({
		uniqueId: uuid,
		versionId: 7,
		lastEdited: 123456,
		config: {
			title: 'รักษาข้อมูล',
			slides: [
				{
					InfoSlide: {
						title: 'image',
						media: { Image: { HashReference: { hash: 'legacy-hash', alt: 'unchanged' } } }
					}
				}
			]
		}
	});
	await query(
		"INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (?,'creation',?,7,?)",
		[owner, uuid, body]
	);
	await query(
		"INSERT INTO host_games(instance_id,code,owner_id,host_watcher_id,origin_unique_id,origin_version_id,session_version) VALUES (?,'45671',?,?,?,7,0)",
		[crypto.randomUUID(), owner, crypto.randomUUID(), uuid]
	);
	await query("INSERT INTO active_games(quiz_id,game_code) VALUES ('legacy-mapping','123456')");
	await query(
		"INSERT INTO fuizzes(id,storage_id,title,author,language,slides_count,subjects) VALUES ('legacy-public','legacy-public-blob','untouched','legacy','th',1,'[\"Math\"]')"
	);
	const tables = ['admins', 'host_resources', 'host_games', 'active_games', 'fuizzes'];
	const before = await Promise.all(tables.map((table) => query(`SELECT * FROM ${table}`)));
	await apply();
	await apply();
	assert.deepEqual(
		await Promise.all(tables.map((table) => query(`SELECT * FROM ${table}`))),
		before
	);
	assert.equal(
		(await query('SELECT body FROM host_resources WHERE owner_id=?', [owner]))[0].body,
		body
	);
}
