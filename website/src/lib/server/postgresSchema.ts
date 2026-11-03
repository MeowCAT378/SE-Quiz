import { fileURLToPath } from 'node:url';
import type { SQL } from 'bun';
import { migratePostgresAccounts } from './accountUpgrade';
import { migratePostgresLlm } from './llmUpgrade';

/** One atomic, repeatable setup path for new and existing installations. Does not seed data. */
export async function initializePostgres(sql: SQL): Promise<void> {
	await sql.begin(async (tx) => {
		// Serialize startup upgrades, including installations with no tables to lock yet.
		await tx`SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':se-quiz-schema'))`;
		await migratePostgresAccounts(tx);
		await migratePostgresLlm(tx);
		await tx.file(fileURLToPath(new URL('../../schema.postgres.sql', import.meta.url)));
	});
}
