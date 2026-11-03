import type { SQL } from 'bun';

/** Run before schema initialization and before serving requests. Never rewrites a password hash. */
export async function upgradePostgresAccounts(sql: SQL): Promise<void> {
	await sql.begin(migratePostgresAccounts);
}

/** The caller owns the transaction so schema setup can roll back as one operation. */
export async function migratePostgresAccounts(tx: SQL): Promise<void> {
	const [exists] = await tx`SELECT to_regclass('admins') AS table_name`;
	if (!exists.table_name) return;
	await tx`LOCK TABLE admins IN SHARE ROW EXCLUSIVE MODE`;
	await tx`ALTER TABLE admins ADD COLUMN IF NOT EXISTS id TEXT, ADD COLUMN IF NOT EXISTS role TEXT, ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS session_version INTEGER`;
	const rows = await tx<{ email: string }[]>`SELECT email FROM admins WHERE id IS NULL`;
	for (const row of rows)
		await tx`UPDATE admins SET id = ${crypto.randomUUID()} WHERE email = ${row.email} AND id IS NULL`;
	await tx`UPDATE admins SET role = 'ADMIN' WHERE role IS NULL`;
	await tx`UPDATE admins SET session_version = 0 WHERE session_version IS NULL`;
	await tx`ALTER TABLE admins ALTER COLUMN id SET NOT NULL, ALTER COLUMN role SET NOT NULL, ALTER COLUMN role SET DEFAULT 'TEACHER', ALTER COLUMN session_version SET NOT NULL, ALTER COLUMN session_version SET DEFAULT 0`;
	const [identity] = await tx`SELECT EXISTS (
			SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='id'
			WHERE i.indrelid='admins'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
			AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
		) AS present`;
	if (!identity.present) await tx`CREATE UNIQUE INDEX admins_stable_id ON admins(id)`;
	// Remove only our redundant, unreferenced index. Older FKs may depend on it instead.
	await tx`DO $$ DECLARE redundant regclass; BEGIN
			SELECT i.indexrelid INTO redundant FROM pg_index i
			JOIN pg_class c ON c.oid=i.indexrelid AND c.relname='admins_stable_id'
			JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='id'
			WHERE i.indrelid='admins'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
			AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=1 AND i.indkey[0]=a.attnum
			AND NOT i.indisreplident AND NOT i.indisclustered
			AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conindid=i.indexrelid)
			AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE refclassid='pg_class'::regclass AND refobjid=i.indexrelid)
			AND EXISTS (SELECT 1 FROM pg_index other WHERE other.indrelid=i.indrelid
				AND other.indexrelid<>i.indexrelid AND other.indisunique AND other.indisvalid AND other.indisready
				AND other.indpred IS NULL AND other.indexprs IS NULL AND other.indnkeyatts=1 AND other.indkey[0]=a.attnum);
			IF redundant IS NOT NULL THEN EXECUTE format('DROP INDEX %s', redundant); END IF;
		END $$`;
	await tx`DO $$ BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'admins'::regclass AND conname = 'admins_managed_values') THEN
				ALTER TABLE admins ADD CONSTRAINT admins_managed_values CHECK (role IN ('TEACHER','ADMIN') AND session_version >= 0 AND id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
			END IF;
		END $$`;
}
