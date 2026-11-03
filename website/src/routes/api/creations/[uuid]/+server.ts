import type { RequestHandler } from '@sveltejs/kit';
import { resourceRoute } from '$lib/server/privateRoutes';
export const GET: RequestHandler = (event) => resourceRoute(event, 'creation', event.params.uuid);
export const PUT = GET;
export const DELETE = GET;
