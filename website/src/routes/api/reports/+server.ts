import type { RequestHandler } from '@sveltejs/kit';
import { resourceRoute } from '$lib/server/privateRoutes';
export const GET: RequestHandler = (event) => resourceRoute(event, 'report');
export const POST = GET;
