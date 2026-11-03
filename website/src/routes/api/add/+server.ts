import { error, json, type RequestHandler } from '@sveltejs/kit';
import { gameStartIssue } from '$lib/gameStartValidation';
import { requireSameOrigin, requireUser } from '$lib/server/guards';
import { signGrant } from '$lib/server/hostAuthorization';
import { getHostGameStore } from '$lib/server/hostGameStore';
import { type BaseHostGameStore, type GameOrigin, isGameCode, isUuid } from '$lib/server/hostGames';
import { notifyRuntime, runtimeUrl } from '$lib/server/hostRuntime';
import { readJsonBody } from '$lib/server/requestBody';

export const POST: RequestHandler = async (event) => {
	const owner = requireUser(event);
	requireSameOrigin(event);
	const payload = await readJsonBody(event.request, 4 * 1024 * 1024);
	if (
		Object.keys(payload).some((key) => !['config', 'options', 'origin'].includes(key)) ||
		!payload.config ||
		typeof payload.config !== 'object' ||
		Array.isArray(payload.config) ||
		!payload.options ||
		typeof payload.options !== 'object' ||
		Array.isArray(payload.options)
	)
		error(400, 'Invalid game payload');
	if (gameStartIssue(payload.config)) error(400, 'Game cannot start');
	let origin: GameOrigin | undefined;
	if (payload.origin !== undefined) {
		const value = payload.origin as GameOrigin;
		if (
			!value ||
			typeof value !== 'object' ||
			Array.isArray(value) ||
			Object.keys(value).some((key) => !['uniqueId', 'versionId'].includes(key)) ||
			!isUuid(value.uniqueId) ||
			!Number.isSafeInteger(value.versionId) ||
			value.versionId < 0
		)
			error(400, 'Invalid creation reference');
		origin = value;
	}
	let store: BaseHostGameStore | undefined;
	try {
		store = await getHostGameStore(event);
	} catch {
		error(503, 'Game ownership service unavailable');
	}
	if (!store) error(503, 'Game ownership service unavailable');
	if (origin) {
		let owned: boolean;
		try {
			owned = await store.ownsOrigin(owner.id, origin);
		} catch {
			error(503, 'Creation service unavailable');
		}
		if (!owned) error(404, 'Creation not found');
	}
	const instanceId = crypto.randomUUID();
	const now = Date.now();
	let target: string;
	let grant: string;
	try {
		target = runtimeUrl('/add');
		grant = signGrant({
			purpose: 'create-game',
			userId: owner.id,
			sessionVersion: owner.sessionVersion,
			issuedAt: now,
			expiresAt: Math.min(now + 60_000, event.locals.session?.expiresAt ?? 0),
			instanceId
		});
	} catch {
		error(503, 'Host authorization unavailable');
	}
	let runtime: { game_id?: unknown; watcher_id?: unknown; instance_id?: unknown };
	try {
		const response = await fetch(target, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(10_000),
			headers: { 'content-type': 'application/json', authorization: `Bearer ${grant}` },
			body: JSON.stringify({ config: payload.config, options: payload.options })
		});
		if (!response.ok) throw new Error('Runtime rejected creation');
		runtime = await readJsonBody(response as unknown as Request, 4096);
		if (
			!isGameCode(runtime.game_id) ||
			!isUuid(runtime.watcher_id) ||
			runtime.instance_id !== instanceId
		)
			throw new Error('Invalid runtime binding');
	} catch {
		await notifyRuntime('/internal/host/games/remove', { instanceId });
		error(502, 'Game creation could not be confirmed');
	}
	// Runtime allocation and ownership persistence cannot commit together. Compensate on
	// failure so an unacknowledged room is not left running without its durable host binding.
	try {
		await store.record(
			{
				instanceId,
				code: runtime.game_id as string,
				ownerId: owner.id,
				hostWatcherId: runtime.watcher_id as string,
				originUniqueId: origin?.uniqueId ?? null,
				originVersionId: origin?.versionId ?? null,
				listed: (payload.options as { lock_after_start?: unknown }).lock_after_start !== true
			},
			owner.sessionVersion
		);
	} catch {
		await notifyRuntime('/internal/host/games/remove', { instanceId });
		error(503, 'Game ownership could not be recorded');
	}
	return json(
		{ game_id: runtime.game_id, watcher_id: runtime.watcher_id, instance_id: instanceId, origin },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
