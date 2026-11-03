import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PostgresAccountStore } from '../src/lib/server/accountsPostgres';
import { seedDevelopmentUsers, seedUsers } from '../src/lib/server/seedUsers';

assert(process.env.TEST_DATABASE_URL, 'Disposable TEST_DATABASE_URL required');
const connection = new URL(process.env.TEST_DATABASE_URL);
assert.equal(connection.hostname, '127.0.0.1');
assert.equal(connection.port, '55439');
assert.equal(connection.pathname, '/auth_test');
const admin = new Bun.SQL(connection.toString());
try {
	for (const scenario of ['empty', 'deleted', 'wrong-role']) {
		const schema = `seed_users_${crypto.randomUUID().replaceAll('-', '')}`;
		await admin.unsafe(`CREATE SCHEMA ${schema}`);
		connection.searchParams.set('options', `-c search_path=${schema}`);
		const sql = new Bun.SQL(connection.toString());
		try {
			await sql.file(fileURLToPath(new URL('../src/schema.postgres.sql', import.meta.url)));
			if (scenario === 'empty') {
				assert.deepEqual(await seedDevelopmentUsers(sql), { created: 2, total: 2 });
				const store = new PostgresAccountStore(sql);
				for (const user of seedUsers) {
					assert.equal((await store.authenticate(user.email, user.password))?.role, user.role);
					assert.equal(await store.authenticate(user.email, 'incorrect-password'), null);
				}
				const administrator = await store.findByEmail(seedUsers[0].email);
				const teacher = await store.findByEmail(seedUsers[1].email);
				assert(administrator && teacher);
				await store.update(administrator.id, administrator.sessionVersion, teacher.id, {
					password: 'changed-teacher-password'
				});
				const before = await sql`SELECT * FROM admins ORDER BY email`;
				assert.deepEqual(await seedDevelopmentUsers(sql), { created: 0, total: 2 });
				assert.deepEqual(await sql`SELECT * FROM admins ORDER BY email`, before);
				assert.equal(await store.authenticate(teacher.email, seedUsers[1].password), null);
				assert(await store.authenticate(teacher.email, 'changed-teacher-password'));
			} else {
				await sql`INSERT INTO admins(id,email,password_hash,role,deleted_at) VALUES (${crypto.randomUUID()},${seedUsers[1].email},'preserved',${scenario === 'deleted' ? 'TEACHER' : 'ADMIN'},${scenario === 'deleted' ? new Date() : null})`;
				const before = await sql`SELECT * FROM admins ORDER BY email`;
				await assert.rejects(seedDevelopmentUsers(sql), /reserved/);
				assert.deepEqual(await sql`SELECT * FROM admins ORDER BY email`, before);
			}
		} finally {
			await sql.close();
			await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
		}
	}
	console.log(
		'User seed PostgreSQL checks passed: roles, login, repeat preservation and atomic conflict refusal.'
	);
} finally {
	await admin.close();
}
