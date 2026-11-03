import { managedDriveRoute } from '../../managedRoutes';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => managedDriveRoute(event, 'report', event.params.uuid);
export const POST = GET;
export const PUT = GET;
export const DELETE = GET;
