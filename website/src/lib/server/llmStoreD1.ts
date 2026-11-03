import type { D1Database } from '@cloudflare/workers-types';
import type { Account } from './accounts';
import { type LlmStatement, LlmStore } from './llmStore';

export class D1LlmStore extends LlmStore {
	constructor(private db: D1Database) {
		super();
	}
	protected async query(query: LlmStatement) {
		return (
			await this.db
				.withSession('first-primary')
				.prepare(query.sql)
				.bind(...query.params)
				.all<Record<string, string | number | null>>()
		).results;
	}
	protected async atomic(_actor: Account, statements: LlmStatement[]) {
		const session = this.db.withSession('first-primary');
		return (
			await session.batch<Record<string, string | number | null>>(
				statements.map((q) => session.prepare(q.sql).bind(...q.params))
			)
		).map((r) => r.results);
	}
}
