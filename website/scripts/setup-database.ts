import { FilesystemBlobStorage } from '../src/lib/blob/filesystem';
import { seedAdmin } from '../src/lib/server/admins';
import { seedDemoGames } from '../src/lib/server/demoGames';
import { getPostgres } from '../src/lib/server/postgres';
import { initializePostgres } from '../src/lib/server/postgresSchema';

async function setup() {
	const { DATABASE_URL, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, ADMIN_SESSION_SECRET } = process.env;
	if (!DATABASE_URL || !ADMIN_SESSION_SECRET) {
		throw new Error('Database and session settings are required');
	}
	const sql = await getPostgres(DATABASE_URL);
	try {
		for (let attempt = 0; ; attempt++) {
			try {
				await sql`SELECT 1`;
				break;
			} catch {
				if (attempt === 29) throw new Error('PostgreSQL did not become ready');
				await Bun.sleep(1000);
			}
		}
		await initializePostgres(sql);
		await seedAdmin(sql, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD);
		if (process.env.SEED_DEMO_GAMES === 'true') {
			const { STORAGE_PROVIDER, STORAGE_PATH } = process.env;
			if ((STORAGE_PROVIDER && STORAGE_PROVIDER !== 'filesystem') || !STORAGE_PATH)
				throw new Error('Demo games require filesystem STORAGE_PATH for pin images');
			const demos = await seedDemoGames(sql, new FilesystemBlobStorage(STORAGE_PATH));
			console.log(
				`Database ready; administrator seed checked; ${demos.created}/${demos.total} demo games created.`
			);
		} else {
			console.log('Database ready; administrator seed checked; demo games disabled.');
		}
	} finally {
		await sql.close();
	}
}

setup().catch(() => {
	console.error(
		'Database setup failed. Check PostgreSQL availability and required private settings.'
	);
	process.exitCode = 1;
});
