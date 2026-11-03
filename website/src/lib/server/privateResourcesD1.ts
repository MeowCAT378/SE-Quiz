import type { D1Database } from '@cloudflare/workers-types';
import type { BaseBlobStorage } from '../blob/base';
import type { Account } from './accounts';
import { PrivateResourceStore, type Row, type Statement } from './privateResources';

export class D1PrivateResourceStore extends PrivateResourceStore {
	protected readonly jsonValues = 'SELECT value FROM json_each(?)';
	constructor(
		private db: D1Database,
		blob?: BaseBlobStorage
	) {
		super(blob);
	}
	protected async query(query: Statement) {
		return (
			await this.db
				.prepare(query.sql)
				.bind(...query.params)
				.all()
		).results;
	}
	protected async atomic(_actor: Account, _ownerId: string, statements: Statement[]) {
		return (
			await this.db.batch<Row>(statements.map((q) => this.db.prepare(q.sql).bind(...q.params)))
		).map((r) => r.results);
	}
}
