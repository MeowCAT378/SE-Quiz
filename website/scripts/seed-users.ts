import { AccountError } from '../src/lib/server/accounts';
import { getPostgres } from '../src/lib/server/postgres';
import { seedDevelopmentUsers } from '../src/lib/server/seedUsers';

async function seed() {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
	const sql = getPostgres(process.env.DATABASE_URL);
	try {
		const { created, total } = await seedDevelopmentUsers(sql);
		console.log(`User seed complete: ${created}/${total} created; existing accounts preserved.`);
	} finally {
		await sql.close();
	}
}

seed().catch((error: unknown) => {
	console.error(
		error instanceof AccountError
			? error.message
			: 'User seed failed. Check DATABASE_URL and initialize the database schema first.'
	);
	process.exitCode = 1;
});
