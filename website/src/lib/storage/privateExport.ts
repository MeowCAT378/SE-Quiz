import type { Database, InternalReport, ReportBody } from '.';
import { accountRequest, StorageError } from './account';

export async function authorizeReportExport(
	report: ReportBody | InternalReport,
	database: Database
): Promise<void> {
	if ('uniqueId' in report) {
		await accountRequest(database, `/api/reports/${encodeURIComponent(report.uniqueId)}`);
		return;
	}
	if (!report.gameInstanceId) throw new StorageError(404);
	const game = await (
		await accountRequest(
			database,
			`/api/host/instances/${encodeURIComponent(report.gameInstanceId)}`
		)
	).json();
	if (
		['gameInstanceId', 'gameCode', 'fuizUniqueId', 'fuizVersionId'].some(
			(key) => game[key] !== report[key as keyof ReportBody]
		)
	)
		throw new StorageError(404);
}
