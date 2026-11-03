import { beforeEach, expect, it, vi } from 'vitest';
import { getHostGameStore } from '../src/lib/server/hostGameStore';
import { POST as add } from '../src/routes/api/add/+server';

const env = vi.hoisted(() => ({
	ADMIN_SESSION_SECRET: 'test-only-host-key',
	GAME_SERVER_INTERNAL_URL: 'http://runtime.test'
}));
vi.mock('$env/dynamic/private', () => ({ env }));
const storage = vi.hoisted(() => ({
	record: vi.fn(),
	ownsOrigin: vi.fn(),
	current: vi.fn(),
	setListed: vi.fn(),
	listed: vi.fn()
}));
vi.mock('$lib/server/hostGameStore', () => ({ getHostGameStore: vi.fn(async () => storage) }));

import { canManageActiveGame } from '../src/lib/homepageAccess';
import {
	signGrant,
	signServiceRequest,
	verifyGrant,
	verifyServiceRequest
} from '../src/lib/server/hostAuthorization';
import { GET as adminActive } from '../src/routes/admin-api/games/active/+server';
import {
	GET as publicActive,
	POST as register,
	DELETE as unlist
} from '../src/routes/api/games/active/+server';
import { POST as authorize } from '../src/routes/api/host/authorize/+server';
import { POST as issue } from '../src/routes/api/host/games/[code]/authorization/+server';

const accounts = vi.hoisted(() => ({ findActiveById: vi.fn() }));
vi.mock('$lib/server/accountStore', () => ({ getAccountStore: vi.fn(async () => accounts) }));
const owner = {
	id: crypto.randomUUID(),
	email: 'owner@example.test',
	role: 'TEACHER',
	sessionVersion: 2,
	deletedAt: null
};
const watcher = crypto.randomUUID();
const payload = { config: { title: 'quiz', slides: [{ MultipleChoice: {} }] }, options: {} };
const instanceId = crypto.randomUUID();
const game = {
	instanceId,
	code: '12345',
	ownerId: owner.id,
	hostWatcherId: watcher,
	originUniqueId: crypto.randomUUID(),
	originVersionId: 3
};

function event(path: string, body: unknown, user: unknown = null, method = 'POST') {
	const url = new URL(path, 'http://web.test');
	return {
		url,
		request: new Request(url, {
			method,
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: method === 'GET' ? undefined : JSON.stringify(body)
		}),
		locals: {
			user,
			session: user ? { issuedAt: Date.now(), expiresAt: Date.now() + 600_000 } : null
		},
		params: {},
		platform: undefined
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	storage.record.mockResolvedValue(undefined);
	storage.ownsOrigin.mockResolvedValue(true);
	storage.current.mockResolvedValue(game);
	accounts.findActiveById.mockResolvedValue(owner);
	storage.setListed.mockResolvedValue(true);
	storage.listed.mockResolvedValue([{ quiz_id: game.originUniqueId, game_code: game.code }]);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url, init) => {
			const grant = verifyGrant(
				new Headers(init.headers).get('authorization')?.slice(7) ?? '',
				'create-game'
			);
			return Response.json({
				game_id: '12345',
				watcher_id: watcher,
				instance_id: grant?.instanceId
			});
		})
	);
});

it('keeps participant discovery public and projects only quiz/code pairs', async () => {
	const request = event('/api/games/active', {}, null, 'GET') as unknown as Parameters<
		typeof publicActive
	>[0];
	request.locals.database = {
		getActiveGames: async () => [{ quiz_id: 'legacy', game_code: 'old-code', owner_id: 'private' }]
	} as never;
	const data = await (await publicActive(request)).json();
	expect(data.games).toEqual([
		{ quiz_id: 'legacy', game_code: 'old-code' },
		{ quiz_id: game.originUniqueId, game_code: game.code }
	]);
	expect(data.ownedGameCodes).toEqual([]);
	const ownerData = await (await publicActive(event('/api/games/active', {}, owner, 'GET'))).json();
	expect(ownerData.ownedGameCodes).toEqual([game.code]);
	expect(canManageActiveGame(owner, ownerData.ownedGameCodes, game.code)).toBe(true);
	const owningAdmin = { ...owner, role: 'ADMIN' as const };
	const owningAdminData = await (
		await publicActive(event('/api/games/active', {}, owningAdmin, 'GET'))
	).json();
	expect(canManageActiveGame(owningAdmin, owningAdminData.ownedGameCodes, game.code)).toBe(true);
	const other = { ...owner, id: crypto.randomUUID() };
	const otherData = await (await publicActive(event('/api/games/active', {}, other, 'GET'))).json();
	expect(otherData.ownedGameCodes).toEqual([]);
	expect(canManageActiveGame(other, otherData.ownedGameCodes, game.code)).toBe(false);
	const admin = { ...owner, id: crypto.randomUUID(), role: 'ADMIN' as const };
	const adminData = await (await publicActive(event('/api/games/active', {}, admin, 'GET'))).json();
	expect(adminData.ownedGameCodes).toEqual([]);
	expect(canManageActiveGame(admin, adminData.ownedGameCodes, game.code)).toBe(false);
	expect(canManageActiveGame(null, data.ownedGameCodes, game.code)).toBe(false);
	await expect(adminActive(request)).rejects.toMatchObject({ status: 401 });
});

it('allows owner registration/removal using the current instance and rejects submitted quiz/code alone', async () => {
	await expect(
		register(
			event('/api/games/active', { quizId: game.originUniqueId, gameCode: game.code }, owner)
		)
	).rejects.toMatchObject({ status: 400 });
	const response = await register(
		event(
			'/api/games/active',
			{ quizId: game.originUniqueId, gameCode: game.code, instanceId },
			owner
		)
	);
	expect(response.status).toBe(200);
	expect(storage.setListed).toHaveBeenLastCalledWith(
		owner.id,
		owner.sessionVersion,
		instanceId,
		true
	);
	await unlist(event('/api/games/active', { gameCode: game.code, instanceId }, owner, 'DELETE'));
	expect(storage.setListed).toHaveBeenLastCalledWith(
		owner.id,
		owner.sessionVersion,
		instanceId,
		false
	);
	await expect(
		unlist(
			event(
				'/api/games/active',
				{ gameCode: game.code, instanceId: crypto.randomUUID() },
				owner,
				'DELETE'
			)
		)
	).rejects.toMatchObject({ status: 404 });
	storage.current.mockResolvedValue({ ...game, ownerId: 'other' });
	await expect(
		register(event('/api/games/active', { gameCode: game.code, instanceId }, owner))
	).rejects.toMatchObject({ status: 404 });
});

function callback(
	purpose: 'create-game' | 'host-game',
	overrides: Record<string, unknown> = {},
	grantOverrides: Record<string, unknown> = {}
) {
	const now = Date.now();
	const grant = signGrant({
		purpose,
		userId: owner.id,
		sessionVersion: 2,
		issuedAt: now,
		expiresAt: now + 60_000,
		instanceId,
		...(purpose === 'host-game' ? { gameCode: game.code, watcherId: watcher } : {}),
		...grantOverrides
	});
	const input = {
		purpose,
		grant,
		instanceId,
		...(purpose === 'host-game' ? { gameCode: game.code, watcherId: watcher } : {}),
		...overrides
	};
	const result = event('/api/host/authorize', input) as unknown as Parameters<typeof authorize>[0];
	result.request.headers.set(
		'x-seopen-service-proof',
		signServiceRequest('POST', result.url.pathname, JSON.stringify(input))
	);
	return result;
}

it('authorizes creation before the owner record exists and returns only scoped current identity', async () => {
	storage.current.mockResolvedValue(null);
	expect(await (await authorize(callback('create-game'))).json()).toMatchObject({
		authorized: true,
		userId: owner.id,
		sessionVersion: 2,
		instanceId
	});
});

it('checks service proof, account version and the exact current instance/watcher on every host callback', async () => {
	const response = await authorize(callback('host-game'));
	expect(await response.json()).toMatchObject({
		authorized: true,
		gameCode: game.code,
		watcherId: watcher,
		instanceId
	});
	expect(response.headers.get('cache-control')).toBe('no-store');
	for (const overrides of [
		{ instanceId: crypto.randomUUID() },
		{ gameCode: '76543' },
		{ watcherId: crypto.randomUUID() }
	])
		await expect(authorize(callback('host-game', overrides))).rejects.toMatchObject({
			status: 403
		});
	storage.current.mockResolvedValue({ ...game, ownerId: crypto.randomUUID() });
	await expect(authorize(callback('host-game'))).rejects.toMatchObject({ status: 403 });
	storage.current.mockResolvedValue(game);
	accounts.findActiveById.mockResolvedValue({ ...owner, sessionVersion: 3 });
	await expect(authorize(callback('host-game'))).rejects.toMatchObject({ status: 403 });
	accounts.findActiveById.mockResolvedValue(null);
	await expect(authorize(callback('host-game'))).rejects.toMatchObject({ status: 403 });
	const forged = callback('host-game');
	forged.request.headers.delete('x-seopen-service-proof');
	await expect(authorize(forged)).rejects.toMatchObject({ status: 401 });
});

it('issues only own current host grants with verified origin and original session expiry', async () => {
	const request = event('/api/host/games/12345/authorization', {}, owner) as unknown as Parameters<
		typeof issue
	>[0];
	request.params = { code: '12345' };
	request.locals.session = { issuedAt: Date.now(), expiresAt: Date.now() + 12000 };
	const response = await issue(request);
	const data = await response.json();
	expect(verifyGrant(data.grant, 'host-game')).toMatchObject({
		userId: owner.id,
		instanceId,
		watcherId: watcher,
		expiresAt: request.locals.session.expiresAt
	});
	expect(data.origin).toEqual({ uniqueId: game.originUniqueId, versionId: game.originVersionId });
	expect(data.instanceId).toBe(instanceId);
	storage.current.mockResolvedValue({ ...game, ownerId: 'another-owner' });
	await expect(issue(request)).rejects.toMatchObject({ status: 404 });
});

it('denies anonymous creation before contacting the runtime', async () => {
	await expect(
		add(event('/api/add', { config: { title: 'quiz', slides: [] }, options: {} }))
	).rejects.toMatchObject({ status: 401 });
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	['default title', { title: 'New Quiz', slides: [{ MultipleChoice: {} }] }],
	['no questions', { title: 'quiz', slides: [] }],
	['info slide only', { title: 'quiz', slides: [{ InfoSlide: {} }] }]
])('rejects game creation with %s before contacting the runtime', async (_label, config) => {
	await expect(add(event('/api/add', { ...payload, config }, owner))).rejects.toMatchObject({
		status: 400
	});
	expect(fetch).not.toHaveBeenCalled();
	expect(storage.record).not.toHaveBeenCalled();
});

it('forwards a scoped creation grant and acknowledges the durable owner before success', async () => {
	const response = await add(event('/api/add', payload, owner));
	expect(response.status).toBe(200);
	expect(storage.record).toHaveBeenCalledWith(
		expect.objectContaining({ ownerId: owner.id, code: '12345', hostWatcherId: watcher }),
		owner.sessionVersion
	);
	const [url, init] = vi.mocked(fetch).mock.calls[0];
	expect(url).toBe('http://runtime.test/add');
	expect(JSON.parse(init?.body as string)).toEqual(payload);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('access-control-allow-origin')).toBeNull();
});

it.each([
	undefined,
	false,
	true
])('records discovery atomically for lock_after_start=%s', async (locked) => {
	const options = locked === undefined ? {} : { lock_after_start: locked };
	await add(event('/api/add', { ...payload, options }, owner));
	expect(storage.record).toHaveBeenCalledWith(
		expect.objectContaining({ listed: locked !== true }),
		owner.sessionVersion
	);
	expect(storage.setListed).not.toHaveBeenCalled();
});

it('rejects forged ownership and unavailable or foreign origin without creating a runtime game', async () => {
	await expect(
		add(event('/api/add', { ...payload, ownerId: owner.id }, owner))
	).rejects.toMatchObject({ status: 400 });
	storage.ownsOrigin.mockResolvedValue(false);
	await expect(
		add(
			event(
				'/api/add',
				{ ...payload, origin: { uniqueId: crypto.randomUUID(), versionId: 3 } },
				owner
			)
		)
	).rejects.toMatchObject({ status: 404 });
	expect(fetch).not.toHaveBeenCalled();
});

it('removes only the newly created instance if durable ownership fails', async () => {
	storage.record.mockRejectedValue(new Error('private database failure'));
	await expect(add(event('/api/add', payload, owner))).rejects.toMatchObject({ status: 503 });
	const [url, init] = vi.mocked(fetch).mock.calls[1];
	expect(url).toBe('http://runtime.test/internal/host/games/remove');
	const body = init?.body as string;
	expect(JSON.parse(body)).toEqual({ instanceId: expect.any(String) });
	expect(
		verifyServiceRequest(
			new Headers(init?.headers).get('x-seopen-service-proof'),
			'POST',
			'/internal/host/games/remove',
			body
		)
	).toBe(true);
});

it('does not retry uncertain creation and requests instance-scoped cleanup', async () => {
	vi.mocked(fetch).mockRejectedValueOnce(new Error('connection lost'));
	await expect(add(event('/api/add', payload, owner))).rejects.toMatchObject({ status: 502 });
	expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
		'http://runtime.test/add',
		'http://runtime.test/internal/host/games/remove'
	]);
});

it('fails closed for missing ownership/account providers and cross-origin requests', async () => {
	vi.mocked(getHostGameStore).mockResolvedValueOnce(undefined);
	await expect(add(event('/api/add', payload, owner))).rejects.toMatchObject({ status: 503 });
	const request = event('/api/add', payload, owner) as unknown as Parameters<typeof add>[0];
	request.request.headers.set('origin', 'http://attacker.test');
	await expect(add(request)).rejects.toMatchObject({ status: 403 });
	accounts.findActiveById.mockRejectedValue(new Error('private provider error'));
	await expect(authorize(callback('host-game'))).rejects.toMatchObject({
		status: 503,
		body: { message: 'Authorization service unavailable' }
	});
	expect(fetch).not.toHaveBeenCalled();
});

it('maps ownership factory failures to unavailable without leaking provider errors', async () => {
	vi.mocked(getHostGameStore).mockRejectedValueOnce(new Error('private connection detail'));
	await expect(add(event('/api/add', payload, owner))).rejects.toMatchObject({
		status: 503,
		body: { message: 'Game ownership service unavailable' }
	});
	vi.mocked(getHostGameStore).mockRejectedValueOnce(new Error('private connection detail'));
	await expect(
		register(event('/api/games/active', { gameCode: game.code, instanceId }, owner))
	).rejects.toMatchObject({ status: 503, body: { message: 'Game ownership service unavailable' } });
});

it('rejects mismatched runtime instance bindings and bounds callback input', async () => {
	vi.mocked(fetch).mockResolvedValueOnce(
		Response.json({ game_id: game.code, watcher_id: watcher, instance_id: crypto.randomUUID() })
	);
	await expect(add(event('/api/add', payload, owner))).rejects.toMatchObject({ status: 502 });
	expect(storage.record).not.toHaveBeenCalled();
	await expect(
		authorize(event('/api/host/authorize', { grant: 'x'.repeat(8192) }))
	).rejects.toMatchObject({ status: 413 });
});
