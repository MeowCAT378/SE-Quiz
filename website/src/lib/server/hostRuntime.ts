import { env } from '$env/dynamic/private';
import { signServiceRequest } from './hostAuthorization';

export function runtimeUrl(path: string): string {
	if (!env.GAME_SERVER_INTERNAL_URL || !env.ADMIN_SESSION_SECRET)
		throw new Error('Host runtime configuration unavailable');
	const url = new URL(path, env.GAME_SERVER_INTERNAL_URL);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
		throw new Error('Invalid host runtime URL');
	return url.toString();
}

/** Notifications never undo durable revocation; runtime checks remain authoritative. */
export async function notifyRuntime(
	path: '/internal/host/revoke' | '/internal/host/games/remove',
	payload: object
): Promise<boolean> {
	try {
		const body = JSON.stringify(payload);
		const response = await fetch(runtimeUrl(path), {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(1000),
			headers: {
				'content-type': 'application/json',
				'x-seopen-service-proof': signServiceRequest('POST', path, body)
			},
			body
		});
		return response.ok;
	} catch {
		return false;
	}
}
