import assert from "node:assert/strict";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
	new URL("../../../../website/package.json", import.meta.url),
);
const { Miniflare } = require("miniflare");
const key = "isolated-worker-test-key",
	versions = new Map(),
	games = new Map();
const owners = new Map(), allSockets = [];
let unavailable = false,
	delay = 0,
	callbacks = 0;
const mac = (purpose, value) =>
	createHmac("sha256", key)
		.update(`seopen:${purpose}:v1\n${value}`)
		.digest("hex");
const sign = (grant) => {
	const body = Buffer.from(JSON.stringify(grant)).toString("base64url");
	return `${body}.${mac("grant", body)}`;
};
const proof = (path, body) => {
	const stamp = Date.now();
	return `${stamp}.${mac("service", `POST\n${path}\n${createHash("sha256").update(body).digest("hex")}\n${stamp}`)}`;
};
const callback = createServer(async (req, res) => {
	try {
		let body = "";
		for await (const bytes of req) body += bytes;
		const [stamp, sig] = req.headers["x-seopen-service-proof"].split(".");
		assert.equal(
			sig,
			mac(
				"service",
				`POST\n${req.url}\n${createHash("sha256").update(body).digest("hex")}\n${stamp}`,
			),
		);
		assert.ok(Math.abs(Date.now() - Number(stamp)) <= 30_000);
		if (req.url === '/api/host/completed') {
			const value = JSON.parse(body), game = games.get(value.instanceId);
			assert.equal(value.ownerId, owners.get(value.instanceId));
			assert.equal(value.gameCode, game.game_id);
			assert.equal(value.watcherId, game.watcher_id);
			game.ended = true;
			res.writeHead(200); res.end('{}'); return;
		}
		const request = JSON.parse(body),
			[encoded, signature] = request.grant.split(".");
		assert.equal(signature, mac("grant", encoded));
		const grant = JSON.parse(Buffer.from(encoded, "base64url"));
		callbacks++;
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
		assert.ok(!unavailable);
		assert.equal(versions.get(grant.userId), grant.sessionVersion);
		assert.ok(grant.expiresAt > Date.now());
		assert.equal(grant.purpose, request.purpose);
		assert.equal(grant.instanceId, request.instanceId);
		if (grant.purpose === "host-game") {
			const game = games.get(grant.instanceId);
			assert.ok(!game.ended);
			assert.equal(game.game_id, request.gameCode);
			assert.equal(game.watcher_id, request.watcherId);
		}
		const { issuedAt, ...decision } = grant;
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ...decision, authorized: true }));
	} catch (error) {
		console.error("callback rejection", error.message);
		res.writeHead(403);
		res.end("{}");
	}
});
await new Promise((resolve) => callback.listen(0, "127.0.0.1", resolve));
const mf = new Miniflare({
	name: "runtime-test",
	modules: true,
	scriptPath: fileURLToPath(new URL("./worker_harness.mjs", import.meta.url)),
	modulesRules: [
		{ type: "ESModule", include: ["**/*.js"], fallthrough: true },
		{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true },
	],
	compatibilityDate: "2024-11-17",
	bindings: {
		ADMIN_SESSION_SECRET: key,
		HOST_AUTHORIZATION_URL: `http://127.0.0.1:${callback.address().port}/api/host/authorize`,
	},
	durableObjects: { GAME: "Game", GAME_MANAGER: "GameManager" },
	serviceBindings: { COUNTER: () => new Response("ok") },
});
const request = (path, body, grant, signed = false) => {
	const encoded = JSON.stringify(body);
	return mf.dispatchFetch(`http://runtime.test${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(grant ? { Authorization: `Bearer ${grant}` } : {}),
			...(signed ? { "X-SEOpen-Service-Proof": proof(path, encoded) } : {}),
		},
		body: encoded,
	});
};
const body = {
	config: { title: "Worker transport", slides: [] },
	options: {
		random_names: null,
		show_answers: true,
		no_leaderboard: false,
		teams: null,
	},
};
async function create(
	owner = randomUUID(),
	instance = randomUUID(),
	payload = body,
) {
	versions.set(owner, versions.get(owner) ?? 0);
	const grant = {
		purpose: "create-game",
		userId: owner,
		sessionVersion: versions.get(owner),
		issuedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		instanceId: instance,
	};
	const response = await request("/add", payload, sign(grant));
	assert.equal(response.status, 200, await response.clone().text());
	const game = await response.json();
	games.set(instance, game);
	owners.set(instance, owner);
	return { owner, grant, game };
}
async function socket(game, watcher = randomUUID()) {
	const response = await mf.dispatchFetch(
		`http://runtime.test/watch/${game.game_id}/${watcher}`,
		{ headers: { Upgrade: "websocket" } },
	);
	assert.equal(response.status, 101);
	const ws = response.webSocket;
	allSockets.push(ws);
	ws.accept();
	const messages = [];
	let notify;
	ws.addEventListener("message", (e) => {
		messages.push(JSON.parse(e.data));
		notify?.();
	});
	ws.addEventListener("close", () => {
		messages.push({ closed: true });
		notify?.();
	});
	return {
		send: (value) => ws.send(JSON.stringify(value)),
		close: () => ws.close(),
		messages,
		async until(predicate, ms = 3000) {
			const end = Date.now() + ms;
			while (Date.now() < end) {
				const index = messages.findIndex(predicate);
				if (index >= 0) return messages.splice(index, 1)[0];
				await new Promise((resolve, reject) => {
					const timer = setTimeout(
						() => {
							notify = undefined;
							reject(Error("WebSocket timeout"));
						},
						Math.max(1, end - Date.now()),
					);
					notify = () => {
						clearTimeout(timer);
						notify = undefined;
						resolve();
					};
				});
			}
			throw Error("Missing message");
		},
	};
}
async function host(owner, game) {
	const grant = {
		purpose: "host-game",
		userId: owner,
		sessionVersion: versions.get(owner),
		issuedAt: Date.now(),
		expiresAt: Date.now() + 300_000,
		instanceId: game.instance_id,
		gameCode: game.game_id,
		watcherId: game.watcher_id,
	};
	const ws = await socket(game, game.watcher_id);
	ws.send({ Authorization: sign(grant) });
	ws.send({ Ghost: { ClaimId: game.watcher_id } });
	await ws.until((m) => m.Game?.WaitingScreen || m.InfoSlide || m.Poll);
	return { ws, grant };
}
try {
	await mf.ready;
	if (process.argv.includes('--timeout-fast')) { await timeoutCases(); } else {
	assert.equal((await request("/add", body)).status, 401);
	const { owner, grant, game } = await create();
	const concurrent = await Promise.all(
		Array.from({ length: 8 }, () =>
			request("/add", body, sign(grant)).then(async (r) => {
				assert.equal(r.status, 200);
				return r.json();
			}),
		),
	);
	assert.ok(
		concurrent.every((value) => JSON.stringify(value) === JSON.stringify(game)),
	);
	const cancelled = randomUUID();
	assert.equal(
		(
			await request(
				"/internal/host/games/remove",
				{ instanceId: cancelled },
				null,
				true,
			)
		).status,
		200,
	);
	assert.equal(
		(await request("/add", body, sign({ ...grant, instanceId: cancelled })))
			.status,
		409,
	);
	const incomplete = await create();
	const incompleteNamespace = await mf.getDurableObjectNamespace("GAME");
	await incompleteNamespace
		.get(incompleteNamespace.idFromName(incomplete.game.instance_id))
		.fetch("http://internal/__test/remove-snapshot");
	await mf.unsafeEvictDurableObject("runtime-test", "Game", {
		name: incomplete.game.instance_id,
		webSockets: "hibernate",
	});
	assert.equal(
		(await request("/add", body, sign(incomplete.grant))).status,
		503,
		"missing durable snapshot must not acknowledge replay",
	);
	// This intentional snapshot-loss fixture cannot produce Summary. Remove
	// only its recorded instance through the existing signed cancellation path.
	assert.equal((await request('/internal/host/games/remove', {
		instanceId: incomplete.game.instance_id
	}, null, true)).status, 200);
	incomplete.game.cancelled = true;
	const delayed = { ...grant, instanceId: randomUUID() };
	delay = 300;
	const beforeCreate = callbacks;
	const lateCreation = request("/add", body, sign(delayed));
	while (callbacks === beforeCreate) await new Promise((r) => setTimeout(r, 5));
	assert.equal(
		(
			await request(
				"/internal/host/games/remove",
				{ instanceId: delayed.instanceId },
				null,
				true,
			)
		).status,
		200,
	);
	assert.equal((await lateCreation).status, 409);
	delay = 0;
	assert.equal(
		(
			await request(
				"/add",
				body,
				sign({
					...grant,
					issuedAt: Date.now() - 60_000,
					expiresAt: Date.now() - 1,
				}),
			)
		).status,
		401,
	);
	console.log("creation replay cancellation passed");
	const { ws: legit } = await host(owner, game);
	console.log("host admitted");
	const attack = await socket(game, game.watcher_id);
	attack.send({ Ghost: { ClaimId: game.watcher_id } });
	await attack.until((m) => m.closed);
	console.log("anonymous host denied");
	legit.send({ Host: "RequestTeamRosters" });
	await legit.until((m) => m.Game?.TeamRosters);
	console.log("legitimate command");
	const player = await socket(game);
	player.send({ Ghost: "DemandId" });
	await player.until((m) => m.Game?.IdAssign);
	player.send({ Unassigned: { NameRequest: "anonymous" } });
	await player.until((m) => m.Game?.NameAssign);
	player.send({ Host: "RequestTeamRosters" });
	await player.until((m) => m.closed);
	console.log("participant joined and forbidden command denied");
	const { ws: replacement } = await host(owner, game);
	console.log("replacement admitted");
	await legit.until((m) => m.closed);
	console.log("old host closed");
	replacement.send({ Host: "RequestTeamRosters" });
	await replacement.until((m) => m.Game?.TeamRosters);
	versions.set(owner, 1);
	const immediateStart = Date.now();
	assert.equal(
		(
			await request(
				"/internal/host/revoke",
				{ userId: owner, minSessionVersion: 1 },
				null,
				true,
			)
		).status,
		200,
	);
	await replacement.until((m) => m.closed);
	const immediate = Date.now() - immediateStart;
	console.log("immediate revoke passed");
	assert.equal(
		await (
			await mf.dispatchFetch(`http://runtime.test/alive/${game.game_id}`)
		).text(),
		"true",
	);
	const { ws: idle } = await host(owner, game);
	versions.set(owner, 2);
	const idleStart = Date.now();
	await idle.until((m) => m.closed, 6500);
	const fallback = Date.now() - idleStart;
	assert.ok(fallback < 6200);
	const { ws: overdue } = await host(owner, game);
	const ns = await mf.getDurableObjectNamespace("GAME");
	const id = ns.idFromName(game.instance_id);
	await ns.get(id).fetch("http://internal/__test/delay-alarm");
	versions.set(owner, 3);
	await new Promise((resolve) => setTimeout(resolve, 6100));
	const spectator = await socket(game);
	spectator.send({ Ghost: "DemandId" });
	await spectator.until((m) => m.Game?.IdAssign);
	spectator.send({ Unassigned: { NameRequest: "after-deadline" } });
	await spectator.until((m) => m.Game?.NameAssign);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.ok(
		!overdue.messages.some((m) => m.Game?.PlayerJoined?.name === "after-deadline"),
		"overdue alarm leaked host broadcast",
	);
	overdue.send({ Host: "RequestTeamRosters" });
	await overdue.until((m) => m.closed);
	const { ws: pending } = await host(owner, game);
	pending.messages.length = 0;
	delay = 300;
	const beforePending = callbacks;
	pending.send({ Host: "RequestTeamRosters" });
	while (callbacks === beforePending)
		await new Promise((r) => setTimeout(r, 5));
	const during = await socket(game);
	during.send({ Ghost: "DemandId" });
	await during.until((m) => m.Game?.IdAssign);
	during.send({ Unassigned: { NameRequest: "during-check" } });
	await during.until((m) => m.Game?.NameAssign);
	assert.ok(
		!pending.messages.some((m) => m.Game?.PlayerJoined?.name === "during-check"),
		"pending callback leaked broadcast",
	);
	await pending.until((m) => m.Game?.TeamRosters);
	delay = 0;
	await pending.until((m) => m.Game?.PlayerJoined?.name === "during-check");
	await mf.unsafeEvictDurableObject("runtime-test", "Game", {
		name: game.instance_id,
		webSockets: "hibernate",
	});
	versions.set(owner, versions.get(owner) + 1);
	pending.send({ Host: "RequestTeamRosters" });
	await pending.until((m) => m.closed);
	assert.ok(
		!pending.messages.some((m) => m.Game?.TeamRosters),
		"recovered stale host command ran",
	);
	const { ws: recovered } = await host(owner, game);
	await mf.unsafeEvictDurableObject("runtime-test", "Game", {
		name: game.instance_id,
		webSockets: "hibernate",
	});
	recovered.send({ Host: "RequestTeamRosters" });
	await recovered.until((m) => m.Game?.TeamRosters);
	await recovered.until((m) => m.Game?.WaitingScreen?.some((player) => player.name === "during-check"));
	const { ws: outage } = await host(owner, game);
	unavailable = true;
	outage.send({ Host: "RequestTeamRosters" });
	await outage.until((m) => m.closed);
	unavailable = false;
	const { ws: timed } = await host(owner, game);
	delay = 2000;
	const timeoutStart = Date.now();
	timed.send({ Host: "RequestTeamRosters" });
	await timed.until((m) => m.closed);
	const timeout = Date.now() - timeoutStart;
	assert.ok(timeout < 1300);
	delay = 0;
	const racing = await create();
	const racingHost = (await host(racing.owner, racing.game)).ws;
	delay = 300;
	const beforeRace = callbacks;
	racingHost.send({ Host: "RequestTeamRosters" });
	while (callbacks === beforeRace) await new Promise((r) => setTimeout(r, 5));
	await request(
		"/internal/host/revoke",
		{ userId: racing.owner, minSessionVersion: 1 },
		null,
		true,
	);
	await racingHost.until((m) => m.closed);
	await new Promise((r) => setTimeout(r, 350));
	assert.ok(
		!racingHost.messages.some((m) => m.Game?.TeamRosters),
		"in-flight callback undid signed revoke",
	);
	delay = 0;
	const benchmarks = [];
	for (const concurrency of [1, 10, 30]) {
		const clients = [];
		for (let i = 0; i < concurrency; i++) {
			const room = await create();
			clients.push((await host(room.owner, room.game)).ws);
		}
		const start = performance.now();
		let failures = 0;
		const latencies = (
			await Promise.all(
				clients.map(async (ws) => {
					const times = [];
					for (let i = 0; i < 10; i++) {
						const start = performance.now();
						try {
							ws.send({ Host: "RequestTeamRosters" });
							await ws.until((m) => m.Game?.TeamRosters);
							times.push(performance.now() - start);
						} catch (error) {
							if (!failures) console.error('benchmark failure', concurrency, error.message, ws.messages);
							failures++;
						}
					}
					return times;
				}),
			)
		)
			.flat()
			.sort((a, b) => a - b);
		benchmarks.push({
			concurrency,
			count: latencies.length,
			p50_ms: latencies[Math.floor(latencies.length / 2)],
			p95_ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
			max_ms: latencies.at(-1),
			commands_per_second:
				latencies.length / ((performance.now() - start) / 1000),
			failures,
		});
		for (const ws of clients) ws.close();
		assert.equal(failures, 0);
	}
	const timedGame = await create(randomUUID(), randomUUID(), {
		...body,
		config: {
			title: "Preserved timer",
			slides: [
				{ InfoSlide: { title: "first", duration: 5000 } },
				{ InfoSlide: { title: "after revocation", duration: null } },
			],
		},
	});
	const timedHost = (await host(timedGame.owner, timedGame.game)).ws;
	const timedPlayer = await socket(timedGame.game);
	timedPlayer.send({ Ghost: "DemandId" });
	await timedPlayer.until((m) => m.Game?.IdAssign);
	timedPlayer.send({ Unassigned: { NameRequest: "timer-player" } });
	await timedPlayer.until((m) => m.Game?.NameAssign);
	timedHost.send({ Host: { Next: "Lobby" } });
	await timedPlayer.until(
		(m) => m.InfoSlide?.ContentAnnouncement?.title === "first",
	);
	versions.set(timedGame.owner, 1);
	await request(
		"/internal/host/revoke",
		{ userId: timedGame.owner, minSessionVersion: 1 },
		null,
		true,
	);
	await timedHost.until((m) => m.closed);
	await mf.unsafeEvictDurableObject("runtime-test", "Game", {
		name: timedGame.game.instance_id,
		webSockets: "hibernate",
	});
	await timedPlayer.until(
		(m) => m.InfoSlide?.ContentAnnouncement?.title === "after revocation",
		6500,
	);
	const poll = await create(randomUUID(), randomUUID(), {
		...body,
		config: {
			title: "Anonymous answer",
			slides: [
				{
					Poll: {
						title: "vote",
						introduce_slide: 0,
						introduce_question: 0,
						time_limit: 5000,
						points_awarded: 0,
						answers: [{ Text: "yes" }, { Text: "no" }],
					},
				},
			],
		},
	});
	const pollHost = (await host(poll.owner, poll.game)).ws;
	const voter = await socket(poll.game);
	voter.send({ Ghost: "DemandId" });
	await voter.until((m) => m.Game?.IdAssign);
	voter.send({ Unassigned: { NameRequest: "voter" } });
	await voter.until((m) => m.Game?.NameAssign);
	pollHost.send({ Host: { Next: "Lobby" } });
	await voter.until((m) => m.Poll?.AnswersAnnouncement);
	versions.set(poll.owner, 1);
	await request(
		"/internal/host/revoke",
		{ userId: poll.owner, minSessionVersion: 1 },
		null,
		true,
	);
	await pollHost.until((m) => m.closed);
	voter.send({ Player: { IndexAnswer: 0 } });
	const result = await voter.until((m) => m.Poll?.AnswersResults);
	assert.deepEqual(result.Poll.AnswersResults.results, {
		counts: [1, 0],
		total_count: 1,
	});
	console.log("participant timer and journal recovery passed");
	console.log(
		JSON.stringify(
			{
				passed:
					"Worker HTTP/WS authorization, replay/cancellation, anonymous join, takeover, revoke, idle, delayed-alarm outgoing denial, outage",
				immediate_ms: immediate,
				fallback_ms: fallback,
				callback_timeout_ms: timeout,
				callbacks,
				benchmarks,
			},
			null,
			2,
		),
	);
	}
} finally {
	unavailable = false; delay = 0;
	try {
	for (const [instance, game] of games) {
		const alive = await (await mf.dispatchFetch(`http://runtime.test/alive/${game.game_id}`)).text();
		console.log({ cleanupCode: game.game_id, alive, ended: !!game.ended });
		if (alive === 'true') {
			versions.set(owners.get(instance), Math.max(1, versions.get(owners.get(instance))));
			const { ws } = await host(owners.get(instance), game);
			ws.send({ Host: 'End' });
			await ws.until(m => m.Game?.Summary);
		}
		assert.equal(await (await mf.dispatchFetch(`http://runtime.test/alive/${game.game_id}`)).text(), 'false');
		const cleanupDeadline = Date.now() + 5000;
		while (!game.ended && !game.cancelled && Date.now() < cleanupDeadline) await new Promise(r => setTimeout(r, 50));
		assert.ok(game.ended || game.cancelled, game.game_id);
	}
	console.log({ cleanupGames: games.size, endedBindings: [...games.values()].filter(g => g.ended).length, cancelledFixtures: [...games.values()].filter(g => g.cancelled).length });
	} finally {
	for (const ws of allSockets) { try { ws.close(); } catch {} }
	console.log({ callbacks });
	await mf.dispose();
	await new Promise((resolve) => callback.close(resolve));
	}
}

async function timeoutCases() {
	const pause = ms => new Promise(r => setTimeout(r, ms));
	const isSummary = m => m.Game?.Summary;
	async function room() {
		const created = await create(randomUUID(), randomUUID(), { ...body, config: { title: 'Timeout transport', slides: [{ InfoSlide: { title: 'host paced', duration: null } }] } });
		const { ws: h } = await host(created.owner, created.game);
		await h.until(m => m.Game?.HostTimeout?.remaining_ms === 6000);
		const p = await socket(created.game); p.send({ Ghost: 'DemandId' }); await p.until(m => m.Game?.IdAssign);
		p.send({ Unassigned: { NameRequest: 'timeout-player' } }); await p.until(m => m.Game?.NameAssign);
		return { ...created, h, p };
	}
	const manual = await room(); const bad = await socket(manual.game); bad.send({ Host: 'End' }); await bad.until(m => m.closed); assert.equal(await (await mf.dispatchFetch(`http://runtime.test/alive/${manual.game.game_id}`)).text(), 'true'); manual.h.send({ Host: 'End' }); await manual.h.until(isSummary); await manual.p.until(isSummary);
	const idle = await room(); idle.h.send({ Host: { Next: 'Lobby' } }); await idle.h.until(m => m.InfoSlide);
	await pause(1000);
	await mf.unsafeEvictDurableObject('runtime-test', 'Game', { name: idle.game.instance_id, webSockets: 'hibernate' });
	const warning = await idle.h.until(m => m.Game?.HostTimeout?.warning, 5000);
	assert.ok(!idle.p.messages.some(m => m.Game?.HostTimeout));
	idle.h.send({ Host: 'Continue' });
	const ack = await idle.h.until(m => m.Game?.HostTimeout?.generation > warning.Game.HostTimeout.generation);
	assert.equal(ack.Game.HostTimeout.remaining_ms, 6000); assert.equal(ack.Game.HostTimeout.warning, false);
	await pause(2200);
	assert.equal(await (await mf.dispatchFetch(`http://runtime.test/alive/${idle.game.game_id}`)).text(), 'true');
	await mf.unsafeEvictDurableObject('runtime-test', 'Game', { name: idle.game.instance_id, webSockets: 'hibernate' });
	await idle.h.until(isSummary, 5000); await idle.p.until(isSummary);
	const detached = await room(); const replacement = (await host(detached.owner, detached.game)).ws;
	await detached.h.until(m => m.closed);
	replacement.send({ Host: 'Continue' }); await replacement.until(m => m.Game?.HostTimeout?.generation >= 3);
	replacement.close(); await pause(1000);
	const reconnect = (await host(detached.owner, detached.game)).ws;
	reconnect.close(); await pause(3000);
	await mf.unsafeEvictDurableObject('runtime-test', 'Game', { name: detached.game.instance_id, webSockets: 'hibernate' });
	assert.equal(await (await mf.dispatchFetch(`http://runtime.test/alive/${detached.game.game_id}`)).text(), 'true');
	await detached.p.until(isSummary, 4000);
	const transition = await create(randomUUID(), randomUUID(), { ...body, config: { title: 'Independent alarms', slides: [{ InfoSlide: { title: 'before transition', duration: 5000 } }, { InfoSlide: { title: 'after transition', duration: null } }] } });
	const transitionHost = (await host(transition.owner, transition.game)).ws;
	transitionHost.send({ Host: { Next: 'Lobby' } });
	await transitionHost.until(m => m.Game?.HostTimeout?.warning, 5000);
	await transitionHost.until(m => m.InfoSlide?.ContentAnnouncement?.title === 'after transition', 2000);
	await transitionHost.until(isSummary, 2000);
	console.log(JSON.stringify({ scenarios: 4, passed: 'End, host-only warning, Continue, expiry, replacement, reconnect, disconnected expiry, eviction before warning and expiration, independent slide alarm' }));
}
