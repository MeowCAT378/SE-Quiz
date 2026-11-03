import { gameExportRoute } from '$lib/server/privateRoutes';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = gameExportRoute;
