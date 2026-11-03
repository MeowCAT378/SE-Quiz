import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export type HostGrant = {
	purpose: 'create-game' | 'host-game';
	userId: string;
	sessionVersion: number;
	issuedAt: number;
	expiresAt: number;
	instanceId?: string;
	gameCode?: string;
	watcherId?: string;
};

// Domain separation and payload spelling must match game/host_authorization.rs exactly.
function mac(purpose: string, payload: string): string {
	if (!env.ADMIN_SESSION_SECRET) throw new Error('ADMIN_SESSION_SECRET is required');
	return createHmac('sha256', env.ADMIN_SESSION_SECRET)
		.update(`seopen:${purpose}:v1\n${payload}`)
		.digest('hex');
}

function matches(actual: string, expected: string): boolean {
	return (
		/^[a-f0-9]{64}$/.test(actual) &&
		timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
	);
}

function validGrant(value: unknown): value is HostGrant {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const grant = value as HostGrant;
	const keys = [
		'purpose',
		'userId',
		'sessionVersion',
		'issuedAt',
		'expiresAt',
		'instanceId',
		'gameCode',
		'watcherId'
	];
	if (Object.keys(value).some((key) => !keys.includes(key))) return false;
	if (grant.purpose !== 'create-game' && grant.purpose !== 'host-game') return false;
	if (typeof grant.userId !== 'string' || !grant.userId || grant.userId.length > 128) return false;
	if (!Number.isSafeInteger(grant.sessionVersion) || grant.sessionVersion < 0) return false;
	if (!Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.expiresAt)) return false;
	const lifetime = grant.expiresAt - grant.issuedAt;
	if (lifetime <= 0 || lifetime > (grant.purpose === 'create-game' ? 60_000 : 300_000))
		return false;
	for (const key of ['instanceId', 'gameCode', 'watcherId'] as const) {
		if (
			grant[key] !== undefined &&
			(typeof grant[key] !== 'string' || !grant[key] || grant[key].length > 128)
		)
			return false;
	}
	return (
		grant.purpose !== 'host-game' || Boolean(grant.instanceId && grant.gameCode && grant.watcherId)
	);
}

export function signGrant(grant: HostGrant): string {
	if (!validGrant(grant)) throw new Error('Invalid host authorization scope');
	const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
	return `${payload}.${mac('grant', payload)}`;
}

export function verifyGrant(
	token: string,
	purpose: HostGrant['purpose'],
	now = Date.now()
): HostGrant | null {
	if (!env.ADMIN_SESSION_SECRET || typeof token !== 'string' || token.length > 4096) return null;
	const [payload, signature, extra] = token.split('.');
	if (extra !== undefined || !payload || !signature || !/^[A-Za-z0-9_-]+$/.test(payload))
		return null;
	if (!matches(signature, mac('grant', payload))) return null;
	try {
		const grant: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
		return validGrant(grant) &&
			grant.purpose === purpose &&
			grant.issuedAt <= now + 30_000 &&
			grant.expiresAt > now
			? grant
			: null;
	} catch {
		return null;
	}
}

function servicePayload(method: string, path: string, body: string, timestamp: number): string {
	return `${method.toUpperCase()}\n${path}\n${createHash('sha256').update(body).digest('hex')}\n${timestamp}`;
}

export function signServiceRequest(
	method: string,
	path: string,
	body: string,
	timestamp = Date.now()
): string {
	if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid service timestamp');
	return `${timestamp}.${mac('service', servicePayload(method, path, body, timestamp))}`;
}

export function verifyServiceRequest(
	proof: string | null,
	method: string,
	path: string,
	body: string,
	now = Date.now()
): boolean {
	if (!proof || !env.ADMIN_SESSION_SECRET || proof.length > 128) return false;
	const [timestampText, signature, extra] = proof.split('.');
	if (extra !== undefined || !/^\d+$/.test(timestampText) || !signature) return false;
	const timestamp = Number(timestampText);
	return (
		Number.isSafeInteger(timestamp) &&
		Math.abs(now - timestamp) <= 30_000 &&
		matches(signature, mac('service', servicePayload(method, path, body, timestamp)))
	);
}
