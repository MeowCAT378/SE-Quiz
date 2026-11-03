import type { SQL } from 'bun';
import { AccountError, type AccountInput, validateAccountInput } from './accounts';
import { hashPassword } from './password';

// Explicit development seeds; never run automatically during application startup.
export const seedUsers: AccountInput[] = [
	{ email: 'admin@admin.com', password: 'admin123456789', role: 'ADMIN' },
	{ email: 'test@test.com', password: 'test123456789', role: 'TEACHER' }
];

export async function seedDevelopmentUsers(sql: SQL) {
	const users = await Promise.all(
		seedUsers.map(async (input) => {
			const user = validateAccountInput(input);
			return { ...user, hash: await hashPassword(user.password) };
		})
	);
	return sql.begin(async (tx) => {
		await tx`LOCK TABLE admins IN SHARE ROW EXCLUSIVE MODE`;
		let created = 0;
		for (const user of users) {
			const [existing] = await tx`SELECT role,deleted_at FROM admins WHERE email=${user.email}`;
			if (existing) {
				if (existing.deleted_at !== null || existing.role !== user.role)
					throw new AccountError(409, `Seed email is reserved by another account: ${user.email}`);
				continue;
			}
			await tx`INSERT INTO admins(id,email,password_hash,role) VALUES (${crypto.randomUUID()},${user.email},${user.hash},${user.role})`;
			created++;
		}
		return { created, total: users.length };
	});
}
