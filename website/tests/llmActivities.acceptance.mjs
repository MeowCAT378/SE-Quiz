// Disposable llm.compose.yml only. Public synthetic credentials; never uses application .env.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:9398';
const out = new URL('../../test-results/llm/activities.json', import.meta.url);
const types = [
	'multiple_choice',
	'true_false',
	'short_answer',
	'slider',
	'ordering',
	'pin_answer',
	'poll',
	'agreement_scale',
	'nps',
	'drop_pin',
	'word_cloud',
	'open_ended',
	'brainstorm'
];
const login = await fetch(`${base}/login`, {
	method: 'POST',
	redirect: 'manual',
	headers: { origin: base, accept: 'text/html' },
	body: new URLSearchParams({
		email: 'admin@llm.fixture',
		password: 'disposable-llm-admin-password'
	})
});
assert.equal(login.status, 303);
const cookie = login.headers
	.getSetCookie()
	.find((value) => value.startsWith('admin_session='))
	?.split(';')[0];
assert(cookie);
let checks = 0;
async function api(path, body, status = 200, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, {
		method,
		headers: { cookie, origin: base, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	assert.equal(response.status, status, `${method} ${path}`);
	checks++;
	return response.json();
}

async function connect(code, watcher = 'new') {
	const socket = new WebSocket(`ws://127.0.0.1:9898/watch/${code}/${watcher}`);
	const queue = [];
	socket.addEventListener('message', (event) => queue.push(JSON.parse(event.data)));
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	return {
		socket,
		send: (value) => socket.send(JSON.stringify(value)),
		async until(predicate) {
			const deadline = Date.now() + 10000;
			while (Date.now() < deadline) {
				while (queue.length) {
					const message = queue.shift();
					if (predicate(message)) return message;
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			throw new Error(`Timed out waiting for game ${code}`);
		}
	};
}

async function playSavedSlides(record) {
	const results = [];
	for (const [index, slide] of record.config.slides.slice(1).entries()) {
		const kind = Object.keys(slide)[0];
		const body = structuredClone(slide[kind]);
		// Speed up only this disposable transport copy; saved template defaults stay intact.
		Object.assign(body, { introduce_slide: 0, introduce_question: 0 });
		if (kind === 'Brainstorm')
			Object.assign(body, { idea_time_limit: 5000, vote_time_limit: 5000 });
		else body.time_limit = 5000;
		if (body.media?.Image.HashReference) {
			const reference = body.media.Image.HashReference;
			const image = await api(`/api/host/media/${reference.hash}`);
			const data = await (await fetch(image.Image.Base64.data)).blob();
			const form = new FormData();
			form.append('image', data);
			const upload = await fetch('http://127.0.0.1:9598/upload', {
				method: 'POST',
				body: form,
				headers: { origin: base }
			});
			assert.equal(upload.status, 200);
			body.media = { Image: { Corkboard: { id: await upload.json(), alt: reference.alt } } };
		}
		const game = await api('/api/add', {
			config: { title: record.config.title, slides: [{ [kind]: body }] },
			options: { random_names: null, show_answers: true, no_leaderboard: false, teams: null },
			origin: { uniqueId: record.uniqueId, versionId: record.versionId }
		});
		const scope = await api(`/api/host/games/${game.game_id}/authorization`, {});
		const host = await connect(game.game_id, scope.watcherId);
		const participant = await connect(game.game_id);
		try {
			host.send({ Authorization: scope.grant });
			host.send({ Ghost: { ClaimId: scope.watcherId } });
			await host.until((message) => message.Game?.WaitingScreen);
			participant.send({ Ghost: 'DemandId' });
			await participant.until((message) => message.Game?.IdAssign);
			participant.send({ Unassigned: { NameRequest: `Learner ${index + 1}` } });
			await participant.until((message) => message.Game?.NameAssign);
			host.send({ Host: { Next: 'Lobby' } });
			await participant.until((message) =>
				kind === 'TypeAnswer'
					? message.TypeAnswer?.QuestionAnnouncement?.accept_answers
					: message[kind]?.[kind === 'Brainstorm' ? 'IdeasAnnouncement' : 'AnswersAnnouncement']
			);
			let answer;
			if (kind === 'MultipleChoice')
				answer = { IndexAnswer: body.answers.findIndex((entry) => entry.correct) };
			else if (kind === 'Poll') answer = { IndexAnswer: 0 };
			else if (kind === 'TypeAnswer') answer = { StringAnswer: body.answers[0] };
			else if (kind === 'Order') answer = { StringArrayAnswer: body.answers };
			else if (kind === 'Slider') answer = { NumberAnswer: body.correct };
			else if (kind === 'Scale') answer = { NumberAnswer: body.min };
			else if (kind === 'Pin') {
				const target = body.correct_area?.Rectangle;
				answer = {
					PointAnswer: target
						? { x: target.x + target.width / 2, y: target.y + target.height / 2 }
						: { x: 0.5, y: 0.5 }
				};
			} else answer = { StringArrayAnswer: ['Classroom idea'] };
			participant.send({ Player: answer });
			if (kind === 'Brainstorm') {
				const vote = await participant.until((message) => message.Brainstorm?.VotingAnnouncement);
				assert.deepEqual(vote.Brainstorm.VotingAnnouncement.ideas, ['Classroom idea']);
				participant.send({ Player: { IndexArrayAnswer: [0] } });
			}
			await participant.until((message) => message[kind]?.AnswersResults);
			await host.until((message) => message[kind]?.AnswersResults);
			host.send({ Host: { Next: { Slide: { [kind]: { index: 0, phase: 'AnswersResults' } } } } });
			if (body.points_awarded > 0) {
				const score = (await participant.until((message) => message.Game?.Score)).Game.Score.score;
				assert(score.points > 0, `${types[index]} earns points`);
			} else {
				const summary = (await participant.until((message) => message.Game?.Summary)).Game.Summary
					.Player;
				assert.deepEqual(summary.points, [0], `${types[index]} is unscored`);
			}
			host.send({ Host: 'End' });
			results.push(`${types[index]}: hosted, joined, answered, results received`);
			console.log(`PASS ${types[index]} play`);
		} finally {
			host.socket.close();
			participant.socket.close();
		}
	}
	return results;
}

if (process.argv[2] !== 'verify') {
	const list = await api('/api/admin/llm');
	let configuration = list.configurations.find(
		(item) => item.name === 'Activity acceptance fixture'
	);
	if (!configuration)
		({ configuration } = await api('/api/admin/llm/save', {
			id: null,
			expectedVersion: null,
			credential: { action: 'remove' },
			settings: {
				name: 'Activity acceptance fixture',
				provider: 'ollama',
				endpoint: 'http://127.0.0.1:11434/v1',
				model: 'fixture-model',
				enabled: true,
				temperature: 0.5,
				topP: 0.95,
				maxOutputTokens: 4096,
				requestTimeoutSeconds: 60,
				generationTimeoutSeconds: 300,
				batchSize: 3,
				maxConcurrentOperations: 2
			}
		}));
	const current = await api('/api/admin/llm');
	if (current.selection.activeId !== configuration.id)
		await api('/api/admin/llm/select', {
			id: configuration.id,
			expectedConfigurationVersion: configuration.version,
			expectedSelectionVersion: current.selection.version
		});
	const id = crypto.randomUUID();
	const title = `AI 13 Types ${Date.now()}`;
	await api(
		'/api/creations',
		{
			uniqueId: id,
			versionId: 0,
			lastEdited: Date.now(),
			config: {
				title,
				slides: [{ InfoSlide: { title: 'Existing content stays', duration: null } }]
			}
		},
		201
	);
	for (const activityType of types) {
		const request = {
			creationId: id,
			activityType,
			topic: 'Classroom learning',
			instructions: '',
			language: 'en',
			...([
				'multiple_choice',
				'true_false',
				'short_answer',
				'slider',
				'ordering',
				'pin_answer'
			].includes(activityType)
				? { difficulty: 'mixed' }
				: {}),
			...(['multiple_choice', 'poll'].includes(activityType) ? { choicesPerItem: 4 } : {})
		};
		for (const itemCount of [1, 10, 11, 30, 0, -1, 1.5]) {
			const response = await api(
				'/api/ai/activities',
				{ ...request, operationId: crypto.randomUUID(), itemCount },
				[1, 10].includes(itemCount) ? 200 : 400
			);
			if ([1, 10].includes(itemCount)) assert.equal(response.drafts.length, itemCount);
			else assert.equal(response.error, 'invalid_request');
		}
	}
	await api(
		'/api/ai/activities',
		{
			operationId: crypto.randomUUID(),
			creationId: id,
			activityType: 'InfoSlide',
			topic: 'No',
			instructions: '',
			language: 'en',
			itemCount: 1
		},
		400
	);
	const record = (await api(`/api/creations/${id}`)).record;
	assert.equal(record.config.slides.length, 1);
	mkdirSync(new URL('./', out), { recursive: true });
	writeFileSync(out, JSON.stringify({ id, title, types, apiChecks: checks }, null, 2));
	console.log(
		`PASS ${checks} fixture API checks: all 13 types, valid 1/10, invalid 11/30/0/-1/1.5, InfoSlide rejected, no implicit saves.`
	);
	console.log(`Browser creation: ${title}`);
} else {
	const saved = JSON.parse(readFileSync(out, 'utf8'));
	const record = (await api(`/api/creations/${saved.id}`)).record;
	assert.equal(record.config.title, saved.title);
	assert.equal(record.config.slides.length, 14, 'Existing slide plus 13 reviewed additions');
	assert.equal(record.config.slides[0].InfoSlide.title, 'Existing content stays');
	const expected = [
		'MultipleChoice',
		'MultipleChoice',
		'TypeAnswer',
		'Slider',
		'Order',
		'Pin',
		'Poll',
		'Scale',
		'Scale',
		'Pin',
		'FreeText',
		'FreeText',
		'Brainstorm'
	];
	assert.deepEqual(
		record.config.slides.slice(1).map((slide) => Object.keys(slide)[0]),
		expected
	);
	assert.equal(record.config.slides[8].Scale.max, 5);
	assert.equal(record.config.slides[9].Scale.max, 10);
	assert.equal(record.config.slides[10].Pin.points_awarded, 0);
	assert.equal(record.config.slides[10].Pin.correct_area, null);
	assert.equal(record.config.slides[11].FreeText.mode, 'WordCloud');
	assert.equal(record.config.slides[12].FreeText.mode, 'OpenEnded');
	assert(record.config.slides[6].Pin.correct_area.Rectangle.width > 0);
	const playback = await playSavedSlides(record);
	writeFileSync(
		out,
		JSON.stringify(
			{
				...saved,
				savedVersion: record.versionId,
				persistence: 'PASS: 13 reviewed additions persisted; title and existing content preserved.',
				playback
			},
			null,
			2
		)
	);
	console.log(
		'PASS saved/reloaded content, all 13 wire mappings, template defaults and teacher target.'
	);
	console.log(`PASS ${playback.length} real HTTP/WebSocket hosting and playing flows.`);
}
