// Run with Node 24 against the disposable Task 7 stack only. Never target live data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.ACCEPTANCE_URL ?? 'http://127.0.0.1:9397';
const runtime = process.env.ACCEPTANCE_RUNTIME ?? 'http://127.0.0.1:9897';
assert.equal(base, 'http://127.0.0.1:9397');
assert.equal(runtime, 'http://127.0.0.1:9897');
const password = 'disposable-teacher-password';
const suffix = randomUUID().slice(0, 8);
let checks = 0;
const evidence = [];
const sockets = new Set();
async function request(path, cookie = '', method = 'GET', body, expected = 200) {
	const response = await fetch(base + path, {
		method,
		redirect: 'manual',
		headers: {
			cookie,
			origin: base,
			accept: path === '/logout' ? 'text/html' : 'application/json',
			'content-type': path === '/logout' ? 'application/x-www-form-urlencoded' : 'application/json'
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	assert.equal(response.status, expected, `${method} ${path}`);
	checks++;
	return response;
}
async function login(email, secret = password, expected = 303) {
	const response = await fetch(base + '/login', {
		method: 'POST',
		redirect: 'manual',
		headers: { origin: base, accept: 'text/html' },
		body: new URLSearchParams({ email, password: secret })
	});
	assert.equal(response.status, expected, 'login status');
	checks++;
	return (
		response.headers
			.getSetCookie()
			.find((value) => value.startsWith('admin_session='))
			?.split(';')[0] ?? ''
	);
}
async function account(admin, label, role) {
	const email = `${label}-${suffix}@acceptance.test`;
	const result = await (
		await request(
			'/api/admin/users',
			admin,
			'POST',
			{ email, password, ...(role ? { role } : {}) },
			201
		)
	).json();
	assert(!('sessionVersion' in result.user) && !('password_hash' in result.user));
	return { ...result.user, cookie: await login(email) };
}
const lobbyQuestion = {
	MultipleChoice: {
		title: 'Acceptance question',
		points_awarded: 1000,
		answers: [
			{ content: { Text: 'Yes' }, correct: true },
			{ content: { Text: 'No' }, correct: false }
		]
	}
};
async function room(cookie, slides = [lobbyQuestion], origin) {
	return (
		await request('/api/add', cookie, 'POST', {
			config: { title: 'Disposable acceptance', slides },
			options: { random_names: null, show_answers: true, no_leaderboard: false, teams: null },
			...(origin ? { origin } : {})
		})
	).json();
}
async function connect(game, watcher = 'new') {
	const socket = new WebSocket(
		runtime.replace('http:', 'ws:') + `/watch/${game.game_id}/${watcher}`
	);
	sockets.add(socket);
	const queue = [];
	socket.addEventListener('message', (event) => queue.push(JSON.parse(event.data)));
	socket.addEventListener('close', () => queue.push({ closed: true }));
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	return {
		socket,
		send: (value) => socket.send(JSON.stringify(value)),
		async until(predicate, timeout = 8000) {
			const end = performance.now() + timeout;
			while (performance.now() < end) {
				while (queue.length) {
					const message = queue.shift();
					if (predicate(message)) return message;
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			throw new Error('Expected WebSocket event not received');
		}
	};
}
async function host(cookie, game) {
	const scope = await (
		await request(`/api/host/games/${game.game_id}/authorization`, cookie, 'POST', {})
	).json();
	const ws = await connect(game, scope.watcherId);
	ws.send({ Authorization: scope.grant });
	ws.send({ Ghost: { ClaimId: scope.watcherId } });
	await ws.until((message) => message.Game?.WaitingScreen);
	return { ...ws, scope };
}
async function player(game, name) {
	const ws = await connect(game);
	ws.send({ Ghost: 'DemandId' });
	const id = (await ws.until((message) => message.Game?.IdAssign)).Game.IdAssign;
	ws.send({ Unassigned: { NameRequest: name } });
	await ws.until((message) => message.Game?.NameAssign);
	return { ...ws, id };
}

try {
	await request('/');
	for (const path of [
		'/api/add',
		'/api/host/games/12345/authorization',
		'/api/creations',
		'/api/admin/users'
	])
		await request(
			path,
			'',
			path.includes('/add') || path.includes('authorization') ? 'POST' : 'GET',
			undefined,
			401
		);
	assert.equal(
		(
			await fetch(runtime + '/add', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					config: { title: 'unauthorized', slides: [] },
					options: { random_names: null, show_answers: true, no_leaderboard: false, teams: null }
				})
			})
		).status,
		401
	);
	for (const path of [
		'/create',
		'/th/create',
		'/host/12345',
		'/reports',
		'/th/reports',
		'/create/__data.json'
	]) {
		const response = await fetch(base + path, { redirect: 'manual' });
		assert([200, 303].includes(response.status));
		const value =
			response.status === 303 ? response.headers.get('location') : await response.text();
		assert(value.includes('/login') && !value.includes('https://'));
		checks++;
	}
	for (const path of ['/register', '/signup', '/api/register'])
		await request(path, '', 'GET', undefined, 404);
	const admin = await login('admin@acceptance.test', 'disposable-admin-password');
	const teacher = await account(admin, 'teacher');
	assert.equal(teacher.role, 'TEACHER');
	const other = await account(admin, 'other');
	const secondAdmin = await account(admin, 'admin', 'ADMIN');
	await request('/admin/users', teacher.cookie, 'GET', undefined, 403);
	await request(
		'/api/admin/users',
		teacher.cookie,
		'POST',
		{ email: 'forged@acceptance.test', password, role: 'ADMIN' },
		403
	);
	await request(
		'/api/admin/users',
		admin,
		'POST',
		{ email: teacher.email.toUpperCase(), password },
		409
	);
	const csrf = await fetch(base + '/api/admin/users', {
		method: 'POST',
		headers: { cookie: admin, origin: 'https://wrong.invalid', 'content-type': 'application/json' },
		body: '{}'
	});
	assert.equal(csrf.status, 403);
	const creation = {
		uniqueId: randomUUID(),
		versionId: 0,
		lastEdited: 1,
		config: { title: 'Private acceptance', slides: [] }
	};
	await request('/api/creations', teacher.cookie, 'POST', creation, 201);
	await request('/api/creations', teacher.cookie, 'POST', creation, 201);
	await request('/api/creations/' + creation.uniqueId, other.cookie, 'GET', undefined, 404);
	await request('/api/creations/' + creation.uniqueId, admin, 'GET', undefined, 404);
	await request('/api/creations', teacher.cookie, 'POST', { ...creation, ownerId: other.id }, 400);
	await request(
		'/api/creations/' + creation.uniqueId,
		teacher.cookie,
		'PUT',
		{ record: { ...creation, versionId: 100 }, expectedVersion: 99 },
		409
	);
	const game = await room(teacher.cookie, undefined, { uniqueId: creation.uniqueId, versionId: 0 });
	await request(`/api/host/games/${game.game_id}/authorization`, other.cookie, 'POST', {}, 404);
	await request(`/api/host/games/${game.game_id}/authorization`, admin, 'POST', {}, 404);
	let active = await host(teacher.cookie, game);
	active.send({ Host: 'RequestTeamRosters' });
	await active.until((message) => message.Game?.TeamRosters);
	const replacement = await host(teacher.cookie, game);
	await active.until((message) => message.closed);
	active = replacement;
	const report = {
		uniqueId: randomUUID(),
		versionId: 0,
		lastEdited: 2,
		title: 'Acceptance report',
		playedAt: 1,
		gameInstanceId: game.instance_id,
		gameCode: game.game_id,
		fuizUniqueId: creation.uniqueId,
		fuizVersionId: 0,
		playerCount: 0,
		questions: [],
		results: []
	};
	await request('/api/reports', teacher.cookie, 'POST', report, 201);
	await request('/api/reports/' + report.uniqueId, teacher.cookie);
	await request('/api/reports/' + report.uniqueId, other.cookie, 'GET', undefined, 404);
	const media = {
		Image: {
			Base64: {
				alt: '',
				data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
			}
		}
	};
	await request('/api/host/media/acceptance-image', teacher.cookie, 'PUT', media);
	await request('/api/host/media/acceptance-image', other.cookie, 'GET', undefined, 404);
	evidence.push(
		'HTTP identity/roles/CSRF/default account, owner CRUD/media/report, host creation/command/reconnect'
	);
	const revocations = [];
	for (const update of [
		{ password: password + '-changed' },
		{ email: `renamed-${suffix}@acceptance.test` },
		{ role: 'ADMIN' },
		{ role: 'TEACHER' }
	]) {
		const oldCookie = teacher.cookie;
		const started = performance.now();
		await request('/api/admin/users/' + teacher.id, admin, 'PATCH', update);
		await active.until((message) => message.closed);
		revocations.push(performance.now() - started);
		await request('/api/account', oldCookie, 'GET', undefined, 401);
		const stale = await connect(game, game.watcher_id);
		stale.send({ Authorization: active.scope.grant });
		stale.send({ Ghost: { ClaimId: game.watcher_id } });
		await stale.until((message) => message.closed);
		if (update.email) teacher.email = update.email;
		teacher.cookie = await login(teacher.email, password + '-changed');
		active = await host(teacher.cookie, game);
	}
	const secondDevice = await login(teacher.email, password + '-changed');
	await request('/logout', teacher.cookie, 'POST', undefined, 303);
	await active.until((message) => message.closed);
	await request('/api/account', secondDevice, 'GET', undefined, 401);
	teacher.cookie = await login(teacher.email, password + '-changed');
	active = await host(teacher.cookie, game);
	await request('/api/admin/users/' + teacher.id, admin, 'DELETE');
	await active.until((message) => message.closed);
	await login(teacher.email, password + '-changed', 401);
	await request('/api/reports/' + report.uniqueId, teacher.cookie, 'GET', undefined, 401);
	await request('/api/admin/users', admin, 'POST', { email: teacher.email, password }, 409);
	await request('/api/admin/users/' + secondAdmin.id, admin, 'PATCH', { role: 'TEACHER' });
	const currentAdmin = (await (await request('/api/account', admin)).json()).user;
	for (const leftover of (await (await request('/api/admin/users', admin)).json()).users)
		if (leftover.id !== currentAdmin.id && leftover.role === 'ADMIN' && !leftover.deletedAt)
			await request('/api/admin/users/' + leftover.id, admin, 'PATCH', { role: 'TEACHER' });
	await request('/api/admin/users/' + currentAdmin.id, admin, 'DELETE', undefined, 409);
	await request('/api/admin/users/' + currentAdmin.id, admin, 'PATCH', { role: 'TEACHER' }, 409);
	evidence.push(
		'Real HTTP password/email/promote/demote/delete/logout invalidate old cookies and open sockets; reserved email; last ADMIN'
	);
	const common = {
		title: 'Anonymous transport',
		introduce_slide: 0,
		introduce_question: 0,
		time_limit: 5000,
		points_awarded: 0
	};
	for (const [kind, config, answer] of [
		[
			'MultipleChoice',
			{
				...common,
				points_awarded: 1000,
				answers: [
					{ content: { Text: 'yes' }, correct: true },
					{ content: { Text: 'no' }, correct: false }
				]
			},
			{ IndexAnswer: 0 }
		],
		['Poll', { ...common, answers: [{ Text: 'yes' }, { Text: 'no' }] }, { IndexAnswer: 0 }],
		[
			'FreeText',
			{ ...common, mode: 'WordCloud', max_entries: 3, max_entry_length: 40 },
			{ StringArrayAnswer: ['hello'] }
		]
	]) {
		const roomData = await room(other.cookie, [{ [kind]: config }]);
		const owner = await host(other.cookie, roomData);
		const participant = await player(roomData, kind);
		participant.socket.close();
		const reconnected = await connect(roomData, participant.id);
		reconnected.send({ Ghost: { ClaimId: participant.id } });
		await reconnected.until((message) => message.Game?.WaitingCount === 1);
		owner.send({ Host: { Next: 'Lobby' } });
		await reconnected.until((message) => message[kind]?.AnswersAnnouncement);
		reconnected.send({ Player: answer });
		const result = await reconnected.until((message) => message[kind]?.AnswersResults);
		assert(result[kind].AnswersResults);
		const hostResult = (await owner.until((message) => message[kind]?.AnswersResults))[kind]
			.AnswersResults;
		if (kind === 'Poll') assert.deepEqual(hostResult.results, { counts: [1, 0], total_count: 1 });
		if (kind === 'MultipleChoice')
			assert.deepEqual(
				hostResult.results.map(({ count, correct }) => ({ count, correct })),
				[
					{ count: 1, correct: true },
					{ count: 0, correct: false }
				]
			);
		if (kind === 'FreeText') {
			assert.equal(hostResult.results.total_count, 1);
			assert.equal(hostResult.results.total_entries, 1);
		}
		evidence.push(`Anonymous ${kind} nickname/reconnect/answer/results over real HTTP/WebSocket`);
	}
	const benchmarks = [];
	for (const concurrency of [1, 10, 30]) {
		const connections = [];
		for (let i = 0; i < concurrency; i++)
			connections.push(await host(other.cookie, await room(other.cookie)));
		const start = performance.now();
		const timings = (
			await Promise.all(
				connections.map(async (connection) => {
					const values = [];
					for (let i = 0; i < 10; i++) {
						const now = performance.now();
						connection.send({ Host: 'RequestTeamRosters' });
						await connection.until((message) => message.Game?.TeamRosters);
						values.push(performance.now() - now);
					}
					connection.socket.close();
					return values;
				})
			)
		)
			.flat()
			.sort((a, b) => a - b);
		benchmarks.push({
			concurrency,
			commands: timings.length,
			p50Ms: timings[Math.floor(timings.length * 0.5)],
			p95Ms: timings[Math.floor(timings.length * 0.95) - 1],
			maxMs: timings.at(-1),
			commandsPerSecond: timings.length / ((performance.now() - start) / 1000),
			failures: 0
		});
	}
	console.log(
		JSON.stringify(
			{
				checks,
				evidence,
				revocationMs: revocations,
				benchmarks,
				retainedOwner: teacher.id,
				retainedCreation: creation.uniqueId,
				retainedReport: report.uniqueId
			},
			null,
			2
		)
	);
} finally {
	for (const socket of sockets) socket.close();
}
