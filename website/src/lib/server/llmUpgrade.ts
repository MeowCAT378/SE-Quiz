import type { SQL } from 'bun';

/** Preserve saved settings, credentials and history while upgrading the timestamp representation. */
export async function upgradePostgresLlm(sql: SQL): Promise<void> {
	await sql.begin(migratePostgresLlm);
}

/** Called inside the startup transaction; invalid legacy values leave the database untouched. */
export async function migratePostgresLlm(tx: SQL): Promise<void> {
	const [exists] = await tx`SELECT to_regclass('llm_configurations') AS table_name`;
	if (exists.table_name)
		await tx`ALTER TABLE llm_configurations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
	await tx`DO $$ DECLARE field record; stored_type regtype; invalid boolean; BEGIN
		FOR field IN SELECT * FROM (VALUES
			('llm_configurations','created_at'), ('llm_configurations','updated_at'),
			('llm_configurations','deleted_at'), ('llm_audit','created_at')
		) AS fields(table_name,column_name) LOOP
			SELECT atttypid::regtype INTO stored_type FROM pg_attribute
			WHERE attrelid=to_regclass(field.table_name) AND attname=field.column_name AND NOT attisdropped;
			IF stored_type IS NULL OR stored_type='timestamptz'::regtype THEN CONTINUE; END IF;
			IF stored_type NOT IN ('text'::regtype, 'varchar'::regtype) THEN
				RAISE EXCEPTION 'Unsupported timestamp type in %.%', field.table_name, field.column_name;
			END IF;
			EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE', field.table_name);
			EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I IS NOT NULL AND
				CASE WHEN pg_input_is_valid(%I, ''timestamptz'') THEN NOT isfinite(%I::timestamptz) ELSE true END)',
				field.table_name, field.column_name, field.column_name, field.column_name) INTO invalid;
			IF invalid THEN
				RAISE EXCEPTION 'Invalid legacy timestamp in %.%; migration rolled back', field.table_name, field.column_name;
			END IF;
			EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I::timestamptz',
				field.table_name, field.column_name, field.column_name);
		END LOOP;
	END $$`;
}

/** Execute before the current D1 schema, including on existing installations. */
export function d1LlmUpgradeStatements(columns: string[]): string[] {
	return columns.length && !columns.includes('deleted_at')
		? ['ALTER TABLE llm_configurations ADD COLUMN deleted_at TEXT']
		: [];
}
