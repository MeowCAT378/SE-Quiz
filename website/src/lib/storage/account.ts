import { resolve } from '$app/paths';
import type { PublicAccount } from '$lib/server/accounts';

export class StorageError extends Error {
	constructor(
		public status: number,
		public code?: string
	) {
		super(`Private storage request failed (${status})`);
	}
}
export type AccountIdentity = { user: PublicAccount; sessionIssuedAt: number };
export type AccountBinding = AccountIdentity & { closed: boolean; close(): void };
const bindings = new Set<AccountBinding>();
const cleared = new Set<() => void>();
export function onAccountStorageCleared(listener: () => void) {
	cleared.add(listener);
	return () => {
		cleared.delete(listener);
	};
}

export function clearAccountStorage() {
	for (const binding of bindings) {
		binding.closed = true;
		binding.close();
	}
	bindings.clear();
	for (const listener of cleared) listener();
}
export function registerAccountStorage(binding: AccountBinding) {
	bindings.add(binding);
}
export async function currentIdentity(): Promise<AccountIdentity> {
	let response: Response;
	try {
		response = await fetch(resolve('/api/account'), { cache: 'no-store' });
	} catch {
		throw new StorageError(503);
	}
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) clearAccountStorage();
		throw new StorageError(response.status);
	}
	const identity = (await response.json()) as AccountIdentity;
	if (!identity.user?.id || !Number.isSafeInteger(identity.sessionIssuedAt)) {
		clearAccountStorage();
		throw new StorageError(503);
	}
	for (const binding of bindings) {
		if (
			binding.user.id !== identity.user.id ||
			binding.sessionIssuedAt !== identity.sessionIssuedAt
		) {
			clearAccountStorage();
			break;
		}
	}
	return identity;
}
export async function verifyAccount(binding: AccountBinding) {
	if (binding.closed) throw new StorageError(401);
	const identity = await currentIdentity();
	if (
		binding.closed ||
		identity.user.id !== binding.user.id ||
		identity.sessionIssuedAt !== binding.sessionIssuedAt
	)
		throw new StorageError(401);
}
export async function accountRequest(
	binding: AccountBinding,
	url: string,
	init: RequestInit = {}
): Promise<Response> {
	await verifyAccount(binding);
	const headers = new Headers(init.headers);
	headers.set('x-seopen-account', binding.user.id);
	headers.set('x-seopen-session', String(binding.sessionIssuedAt));
	if (init.body) headers.set('content-type', 'application/json');
	let response: Response;
	try {
		response = await fetch(resolve(url), { ...init, headers, cache: 'no-store' });
	} catch {
		throw new StorageError(503);
	}
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) clearAccountStorage();
		let code: string | undefined;
		if (url === '/api/ai/activities') {
			try {
				const body = await response.json();
				if (
					[
						'request_timeout',
						'generation_timeout',
						'cancelled',
						'ai_busy',
						'ai_unavailable',
						'provider_unavailable',
						'authentication_failed',
						'model_unavailable',
						'unsupported_option',
						'rate_limited',
						'invalid_response',
						'truncated_response',
						'empty_response',
						'unexpected_tool_call',
						'provider_error'
					].includes(body.error)
				)
					code = body.error;
			} catch {
				/* A malformed error response remains a storage error. */
			}
		}
		if (code) await verifyAccount(binding);
		throw new StorageError(response.status, code);
	}
	// A response begun by the previous login must not enter a newly selected cache/view.
	await verifyAccount(binding);
	return response;
}
