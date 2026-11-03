import type { SQL } from 'bun';
import type { Account } from './accounts';
import { type LlmStatement, LlmStore } from './llmStore';

function placeholders(text: string) {
	let index = 0;
	return text.replaceAll('?', () => `$${++index}`);
}

// Keep the shared PostgreSQL/D1 store and public API on ISO strings, including milliseconds.
function normalize(rows: Record<string, string | number | Date | null>[]) {
	return rows.map((row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, value]) => [
				key,
				value instanceof Date ? value.toISOString() : value
			])
		)
	);
}
export class PostgresLlmStore extends LlmStore {
	constructor(private sql: SQL) {
		super();
	}
	protected async query(query: LlmStatement) {
		return normalize(await this.sql.unsafe(placeholders(query.sql), query.params));
	}
	protected async atomic(actor: Account, statements: LlmStatement[]) {
		return await this.sql.begin(async (tx) => {
			await tx`SELECT id FROM admins WHERE id=${actor.id} FOR SHARE`;
			const results = [];
			for (const query of statements)
				results.push(normalize(await tx.unsafe(placeholders(query.sql), query.params)));
			return results;
		});
	}
}
