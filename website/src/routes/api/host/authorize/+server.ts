import { error, json, type RequestHandler } from '@sveltejs/kit';
import { stripBase } from '$lib/navigation/basePath';
import { getAccountStore } from '$lib/server/accountStore';
import type { Account } from '$lib/server/accounts';
import { verifyGrant, verifyServiceRequest } from '$lib/server/hostAuthorization';
import { getHostGameStore } from '$lib/server/hostGameStore';
import type { HostGame } from '$lib/server/hostGames';
import { readTextBody } from '$lib/server/requestBody';

export const POST: RequestHandler = async (event) => {
	const body = await readTextBody(event.request, 8192);
	if (
		!verifyServiceRequest(
			event.request.headers.get('x-seopen-service-proof'),
			'POST',
			stripBase(event.url.pathname),
			body
		)
	)
		error(401, 'Service authentication required');
	let input: Record<string, unknown>;
	try {
		input = JSON.parse(body);
	} catch {
		error(400, 'Invalid authorization request');
	}
	if (
		!input ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		Object.keys(input).some(
			(key) => !['grant', 'purpose', 'instanceId', 'gameCode', 'watcherId'].includes(key)
		) ||
		typeof input.grant !== 'string' ||
		!['create-game', 'host-game'].includes(input.purpose as string)
	)
		error(400, 'Invalid authorization request');
	const grant = verifyGrant(input.grant, input.purpose as 'create-game' | 'host-game');
	if (!grant || !grant.instanceId || grant.instanceId !== input.instanceId)
		error(403, 'Host authorization denied');
	if (
		grant.purpose === 'create-game' &&
		(input.gameCode !== undefined || input.watcherId !== undefined)
	)
		error(403, 'Host authorization denied');
	if (
		grant.purpose === 'host-game' &&
		(grant.gameCode !== input.gameCode || grant.watcherId !== input.watcherId)
	)
		error(403, 'Host authorization denied');
	// A valid short-lived grant is not a revocation cache: consult the current account and,
	// for host commands, the current instance binding on every runtime authorization check.
	let account: Account | null;
	try {
		const store = await getAccountStore(event);
		if (!store) throw new Error('Unavailable');
		account = await store.findActiveById(grant.userId);
	} catch {
		error(503, 'Authorization service unavailable');
	}
	if (
		!account ||
		account.deletedAt !== null ||
		account.sessionVersion !== grant.sessionVersion ||
		!['ADMIN', 'TEACHER'].includes(account.role)
	)
		error(403, 'Host authorization denied');
	if (grant.purpose === 'host-game') {
		let game: HostGame | null;
		try {
			const store = await getHostGameStore(event);
			if (!store) throw new Error('Unavailable');
			game = await store.current(grant.gameCode ?? '');
		} catch {
			error(503, 'Authorization service unavailable');
		}
		if (
			!game ||
			game.instanceId !== grant.instanceId ||
			game.ownerId !== account.id ||
			game.hostWatcherId !== grant.watcherId
		)
			error(403, 'Host authorization denied');
	}
	return json(
		{
			authorized: true,
			purpose: grant.purpose,
			userId: account.id,
			sessionVersion: account.sessionVersion,
			instanceId: grant.instanceId,
			gameCode: grant.gameCode,
			watcherId: grant.watcherId,
			expiresAt: grant.expiresAt
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
