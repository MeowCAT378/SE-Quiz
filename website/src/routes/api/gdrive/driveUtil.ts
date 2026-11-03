import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Cookies, error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { Account } from '$lib/server/accounts';
import { requireAdmin, requireUser } from '$lib/server/guards';
import { readTextBody } from '$lib/server/requestBody';
import type { InternalFuizMetadataStrings } from '$lib/storage';

export interface OAuthTokens {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
}

export const options = () =>
	({
		clientId: env.AUTH_GOOGLE_ID,
		clientSecret: env.AUTH_GOOGLE_SECRET,
		redirectUri: env.AUTH_GOOGLE_REDIRECT_URI
	}) as const;

export const scope = 'https://www.googleapis.com/auth/drive.appdata' as const;

export function generateAuthUrl(state: string): string {
	const { clientId, redirectUri } = options();
	if (!clientId || !redirectUri) error(500, 'Google Drive OAuth not configured');
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope,
		access_type: 'offline',
		prompt: 'consent',
		state
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
	const { clientId, clientSecret, redirectUri } = options();
	if (!clientId || !clientSecret || !redirectUri) error(500, 'Google Drive OAuth not configured');
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri
		})
	});
	if (!response.ok) throw new Error('Failed to exchange code for tokens');
	return await response.json();
}

export const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const };
// Bind OAuth state and tokens to the local account version; sharing a Google account does
// not grant access to another local user's namespace. The MAC authenticates, not encrypts.
export function sealGoogle(purpose: string, actor: Account, data: unknown, maxAge: number): string {
	if (!env.ADMIN_SESSION_SECRET) error(503, 'OAuth unavailable');
	const body = Buffer.from(
		JSON.stringify({
			purpose,
			userId: actor.id,
			version: actor.sessionVersion,
			expires: Date.now() + maxAge * 1000,
			data
		})
	).toString('base64url');
	return (
		body +
		'.' +
		createHmac('sha256', env.ADMIN_SESSION_SECRET)
			.update('seopen:google:v1:' + body)
			.digest('hex')
	);
}
export function openGoogle<T>(
	value: string | undefined,
	purpose: string,
	actor: Account
): T | undefined {
	if (!value || !env.ADMIN_SESSION_SECRET || value.length > 12000) return undefined;
	try {
		const [body, mac, extra] = value.split('.');
		if (extra || !/^[a-f0-9]{64}$/.test(mac)) return undefined;
		const expected = createHmac('sha256', env.ADMIN_SESSION_SECRET)
			.update('seopen:google:v1:' + body)
			.digest();
		if (!timingSafeEqual(expected, Buffer.from(mac, 'hex'))) return undefined;
		const parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
		if (
			parsed.purpose !== purpose ||
			parsed.userId !== actor.id ||
			parsed.version !== actor.sessionVersion ||
			!Number.isSafeInteger(parsed.expires) ||
			parsed.expires <= Date.now()
		)
			return undefined;
		return parsed.data as T;
	} catch {
		return undefined;
	}
}
export type BoundTokens = { tokens: OAuthTokens; legacy: boolean };
export function getToken(event: RequestEvent): BoundTokens | undefined {
	const actor = requireUser(event);
	const bound = openGoogle<BoundTokens>(event.cookies.get('google'), 'tokens', actor);
	if (!bound?.tokens?.access_token) {
		for (const name of ['google', 'oauth_state', 'oauth_return'])
			event.cookies.delete(name, { path: '/' });
		return undefined;
	}
	return bound;
}
export function storeToken(cookies: Cookies, actor: Account, tokens: OAuthTokens, legacy = false) {
	cookies.set('google', sealGoogle('tokens', actor, { tokens, legacy }, 365 * 86400), {
		...cookieOptions,
		maxAge: 365 * 86400
	});
}

export async function refreshToken(tokens: OAuthTokens): Promise<OAuthTokens | undefined> {
	try {
		if (!tokens.refresh_token) return undefined;
		const { clientId, clientSecret } = options();
		if (!clientId || !clientSecret) return undefined;
		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: tokens.refresh_token,
				client_id: clientId,
				client_secret: clientSecret
			})
		});
		if (!response.ok) return undefined;
		const data = await response.json();
		if (!data.access_token) return undefined;
		return {
			...tokens,
			access_token: data.access_token,
			...(data.refresh_token && { refresh_token: data.refresh_token }),
			...(data.expires_in && { expires_in: data.expires_in })
		};
	} catch {
		return undefined;
	}
}

export type File = {
	id: string;
};

type ExportFileProperties = { [k: string]: string | number | ExportFileProperties };

type FileProperties = { [k: string]: string | FileProperties };

interface MediaData {
	type: string;
	data: string;
}

class Drive {
	constructor(
		private readonly tokens: OAuthTokens,
		private readonly cookies: Cookies,
		private readonly actor: Account,
		private readonly legacy: boolean,
		private readonly legacyAccess: boolean
	) {}

	private async apiFetch(
		path: string,
		{ upload, headers, ...init }: RequestInit & { upload?: boolean } = {}
	): Promise<Response> {
		const base = upload
			? 'https://www.googleapis.com/upload/drive/v3/files'
			: 'https://www.googleapis.com/drive/v3/files';
		const doFetch = (token: string) =>
			fetch(`${base}${path}`, {
				...init,
				headers: {
					...(headers as Record<string, string>),
					Authorization: `Bearer ${token}`
				}
			});

		const response = await doFetch(this.tokens.access_token);

		if (response.status === 401 && this.tokens.refresh_token) {
			const refreshed = await refreshToken(this.tokens);
			if (refreshed) {
				Object.assign(this.tokens, refreshed);
				storeToken(this.cookies, this.actor, refreshed, this.legacyAccess);
				return doFetch(refreshed.access_token);
			}
		}

		return response;
	}

	private query(search: Record<string, string>) {
		const escapeQuery = (value: string) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
		const namespace = this.legacy
			? "not appProperties has { key='seopenAccount' }"
			: `appProperties has { key='seopenAccount' and value='${this.actor.id}' }`;
		return [
			'trashed = false',
			namespace,
			...Object.entries(search).map(([key, value]) => `${key} = '${escapeQuery(value)}'`)
		].join(' and ');
	}

	async deleteFile(file: File) {
		if (this.legacy) error(403, 'Legacy sources are read only');
		const response = await this.apiFetch(`/${encodeURIComponent(file.id)}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			throw new Error(`Failed to delete file: ${response.status} ${response.statusText}`);
		}
	}

	async content(file: File): Promise<string | undefined> {
		try {
			const response = await this.apiFetch(`/${encodeURIComponent(file.id)}?alt=media`);

			if (!response.ok) {
				return undefined;
			}

			return await readTextBody(
				new Request('https://drive-response.invalid', {
					method: 'POST',
					body: response.body,
					duplex: 'half'
				} as RequestInit),
				8 * 1024 * 1024
			);
		} catch {
			return undefined;
		}
	}

	private buildMultipartBody(
		metadata: object,
		data: MediaData
	): { body: string; boundary: string } {
		const boundary = 'fuiz_boundary_' + crypto.randomUUID();
		const body = [
			`--${boundary}`,
			'Content-Type: application/json; charset=UTF-8',
			'',
			JSON.stringify(metadata),
			`--${boundary}`,
			`Content-Type: ${data.type}`,
			'',
			data.data,
			`--${boundary}--`
		].join('\r\n');
		return { body, boundary };
	}

	async create(fileProperties: ExportFileProperties, data: MediaData) {
		if (this.legacy) error(403, 'Legacy sources are read only');
		const metadata = {
			...fileProperties,
			appProperties: { seopenAccount: this.actor.id },
			parents: ['appDataFolder']
		};
		const { body, boundary } = this.buildMultipartBody(metadata, data);

		const response = await this.apiFetch('?uploadType=multipart', {
			upload: true,
			method: 'POST',
			headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
			body
		});

		if (!response.ok) {
			throw new Error(`Failed to create file: ${response.status} ${response.statusText}`);
		}
	}

	async list<T extends FileProperties>(
		fields: Array<keyof T>,
		search: Record<string, string>,
		pageToken?: string
	): Promise<T[]> {
		const q = this.query(search);

		const params = new URLSearchParams({
			q,
			fields: `nextPageToken, files(${fields.join(', ')})`,
			spaces: 'appDataFolder',
			pageSize: '1000'
		});
		if (pageToken) params.set('pageToken', pageToken);

		const response = await this.apiFetch(`?${params}`);

		if (!response.ok) {
			throw new Error(`Failed to list files: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		const files = (data.files || []) as Array<T>;

		return data.nextPageToken
			? files.concat(await this.list(fields, search, data.nextPageToken))
			: files;
	}
}

export function getDrive(event: RequestEvent, legacy = false) {
	const actor = legacy ? requireAdmin(event) : requireUser(event);
	const bound = getToken(event);
	if (!bound || (legacy && !bound.legacy)) error(401, 'Connect Google Drive for this account');
	return new Drive(bound.tokens, event.cookies, actor, legacy, bound.legacy);
}
export async function getFilesIdFromName(service: Drive, name: string, mimeType: string) {
	return service.list<{ id: string; name: string; properties: InternalFuizMetadataStrings }>(
		['id', 'name', 'properties'],
		{ name, mimeType }
	);
}

/**
 * Everything lives in one flat appDataFolder, so mimeType is the only type discriminator.
 * Reports must never reuse `application/json` or they would show up in creation listings and
 * be reconciled as quizzes.
 */
export const CREATION_MIME_TYPE = 'application/json';
export const REPORT_MIME_TYPE = 'application/vnd.fuiz.report+json';
