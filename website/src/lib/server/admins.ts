import type { SQL } from 'bun';
import { PostgresAccountStore } from './accountsPostgres';

export function seedAdmin(sql: SQL, email?: string, password?: string): Promise<boolean> {
	return new PostgresAccountStore(sql).seed(email, password);
}
