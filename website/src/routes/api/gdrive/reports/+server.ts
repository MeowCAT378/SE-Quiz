import { managedDriveRoute } from '../managedRoutes';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => managedDriveRoute(event, 'report');
