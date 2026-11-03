const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Execute this ordered list in one D1 batch before installing the current schema/triggers. */
export function d1AccountUpgradeStatements(
	columns: string[],
	rows: { email: string; id?: string | null }[]
): string[] {
	if (!columns.length) return [];
	const statements: string[] = [];
	for (const [name, type] of [
		['id', 'TEXT'],
		['role', "TEXT DEFAULT 'TEACHER'"],
		['deleted_at', 'TEXT'],
		['session_version', 'INTEGER DEFAULT 0']
	]) {
		if (!columns.includes(name)) statements.push(`ALTER TABLE admins ADD COLUMN ${name} ${type}`);
	}
	for (const row of rows) {
		if (!row.id)
			statements.push(
				`UPDATE admins SET id=${quote(crypto.randomUUID())} WHERE email=${quote(row.email)} AND id IS NULL`
			);
		if (!columns.includes('role'))
			statements.push(`UPDATE admins SET role='ADMIN' WHERE email=${quote(row.email)}`);
	}
	statements.push(
		"UPDATE admins SET role='ADMIN' WHERE role IS NULL",
		'UPDATE admins SET session_version=0 WHERE session_version IS NULL',
		'CREATE UNIQUE INDEX IF NOT EXISTS admins_stable_id ON admins(id)'
	);
	return statements;
}
