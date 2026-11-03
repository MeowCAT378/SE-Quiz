import assert from 'node:assert/strict';

/** Shared behavioral checks for PostgreSQL constraints and D1 upgrade triggers. */
export async function exerciseSchemaIntegrity(
	query: (sql: string, params?: (string | number | null)[]) => Promise<unknown[]>
) {
	const owner = crypto.randomUUID();
	const resource = crypto.randomUUID();
	const configuration = crypto.randomUUID();
	const audit = crypto.randomUUID();
	await query("INSERT INTO admins(id,email,password_hash,role) VALUES (?,?,'fixture','ADMIN')", [
		owner,
		`${owner}@schema.fixture`
	]);
	await query(
		"INSERT INTO fuizzes(id,storage_id,title,author,language,slides_count,subjects,grades,keywords) VALUES (?,?,'Fixture','Fixture','th',1,?,NULL,'[]')",
		[resource, resource, ' [ "Math" ] ']
	);
	const body = ` { "versionId": 0, "uniqueId": "${resource}", "config": {} } `;
	await query(
		"INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (?,'creation',?,0,?)",
		[owner, resource, body]
	);
	await query(
		"INSERT INTO llm_configurations(id,settings,version,created_at,updated_at,created_by,updated_by) VALUES (?,'{\"enabled\":false}',1,'2026-10-05T00:00:00.123Z','2026-10-05T00:00:00.123Z',?,?)",
		[configuration, owner, owner]
	);
	await query(
		"INSERT INTO llm_audit(id,configuration_id,configuration_version,actor_id,created_at,action,changed_fields,credential_action) VALUES (?,?,1,?,'2026-10-05T00:00:00.123Z','create','[]','remove')",
		[audit, configuration, owner]
	);
	const tables = ['fuizzes', 'host_resources', 'llm_configurations', 'llm_audit'];
	const before = await Promise.all(tables.map((table) => query(`SELECT * FROM ${table}`)));
	for (const column of ['subjects', 'grades', 'keywords']) {
		for (const invalid of ['broken', '{}', 'null', '"Math"']) {
			await assert.rejects(query(`UPDATE fuizzes SET ${column}=? WHERE id=?`, [invalid, resource]));
			await assert.rejects(
				query(
					`INSERT INTO fuizzes(id,storage_id,title,author,language,slides_count,${column}) VALUES (?,?,'Fixture','Fixture','th',0,?)`,
					[`${resource}-bad`, `${resource}-bad`, invalid]
				)
			);
		}
	}
	for (const column of ['slides_count', 'played_count', 'view_count']) {
		await assert.rejects(query(`UPDATE fuizzes SET ${column}=-1 WHERE id=?`, [resource]));
	}
	for (const invalid of ['broken', '[]', 'null', '"text"']) {
		await assert.rejects(
			query('UPDATE host_resources SET body=? WHERE unique_id=?', [invalid, resource])
		);
		await assert.rejects(
			query(
				"INSERT INTO host_resources(owner_id,kind,unique_id,version_id,body) VALUES (?,'report',?,0,?)",
				[owner, `${resource}-bad`, invalid]
			)
		);
		await assert.rejects(
			query('UPDATE llm_configurations SET settings=? WHERE id=?', [invalid, configuration])
		);
	}
	for (const invalid of ['broken', '{}', 'null', '"name"']) {
		await assert.rejects(
			query('UPDATE llm_audit SET changed_fields=? WHERE id=?', [invalid, audit])
		);
	}
	for (const [column, invalid] of [
		['action', 'unexpected'],
		['credential_action', 'unexpected'],
		['configuration_version', 0]
	] as const) {
		await assert.rejects(query(`UPDATE llm_audit SET ${column}=? WHERE id=?`, [invalid, audit]));
	}
	assert.deepEqual(
		await Promise.all(tables.map((table) => query(`SELECT * FROM ${table}`))),
		before
	);
	assert.deepEqual(await query('SELECT body FROM host_resources WHERE unique_id=?', [resource]), [
		{ body }
	]);
}
