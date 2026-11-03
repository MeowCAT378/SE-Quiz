import { resolve } from '$app/paths';
import type { FuizOrigin } from '$lib/clientOnly';
import type { HostAuthorizationFrame } from '../routes/[[lang=locale]]/host';
export type HostAuthorization = {
	grant: string;
	watcherId: string;
	instanceId: string;
	origin: FuizOrigin | null;
};

export function hostControlFrame(command: 'End' | 'Continue'): string {
	return JSON.stringify({ Host: command });
}

export async function requestHostAuthorization(
	code: string,
	signal?: AbortSignal
): Promise<HostAuthorization> {
	const response = await fetch(
		resolve(`/api/host/games/${encodeURIComponent(code)}/authorization`),
		{
			method: 'POST',
			cache: 'no-store',
			signal
		}
	);
	if (!response.ok) throw new Error('Host authorization unavailable');
	const value = await response.json();
	if (
		typeof value.grant !== 'string' ||
		!value.grant ||
		typeof value.watcherId !== 'string' ||
		!value.watcherId ||
		typeof value.instanceId !== 'string' ||
		!value.instanceId
	)
		throw new Error('Invalid host authorization');
	return value;
}
export function sendHostAuthorization(
	socket: Pick<WebSocket, 'send'>,
	authorization: HostAuthorization,
	claim: boolean
): void {
	const frame: HostAuthorizationFrame = { Authorization: authorization.grant };
	socket.send(JSON.stringify(frame));
	if (claim) socket.send(JSON.stringify({ Ghost: { ClaimId: authorization.watcherId } }));
}
export async function hideHostedGame(gameCode: string, instanceId: string): Promise<void> {
	const response = await fetch(resolve('/api/games/active'), {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ gameCode, instanceId })
	});
	if (!response.ok) throw new Error('Unable to hide hosted game');
}
