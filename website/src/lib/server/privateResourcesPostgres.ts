import type { SQL } from 'bun';
import type { BaseBlobStorage } from '../blob/base';
import type { Account } from './accounts';
import { PrivateResourceStore, type Row, type Statement } from './privateResources';

const sqlText = (text: string) => {
	let index = 0;
	return text.replaceAll('?', () => `$${++index}`);
};
export class PostgresPrivateResourceStore extends PrivateResourceStore {
	protected readonly jsonValues =
		'SELECT jsonb_array_elements_text(CAST(CAST(? AS TEXT) AS jsonb))';
	constructor(
		private sql: SQL,
		blob?: BaseBlobStorage
	) {
		super(blob);
	}
	protected async query(query: Statement): Promise<Row[]> {
		return await this.sql.unsafe(sqlText(query.sql), query.params);
	}
	protected async atomic(
		actor: Account,
		ownerId: string,
		statements: Statement[]
	): Promise<Row[][]> {
		return await this.sql.begin(async (tx) => {
			// Account locks prevent revocation/deletion from committing between authority check and write.
			await tx`SELECT id FROM admins WHERE id IN (${actor.id},${ownerId}) ORDER BY id FOR SHARE`;
			const results: Row[][] = [];
			for (const query of statements)
				results.push(await tx.unsafe(sqlText(query.sql), query.params));
			return results;
		});
	}
}
