import assert from 'node:assert/strict';
import { request } from '@playwright/test';

// Run only against website/tests/llm.compose.yml, which uses disposable data.
const base = 'http://127.0.0.1:9398';
const provider = 'http://127.0.0.1:11435';
const internalProvider = 'http://127.0.0.1:11434/v1';
const contexts = [];
const context = async () => {
	const value = await request.newContext();
	contexts.push(value);
	return value;
};
const post = (client, path, data) =>
	client.post(`${base}${path}`, { headers: { origin: base }, data });
const login = (client, email, password) =>
	client.post(`${base}/login`, {
		form: { email, password },
		headers: { origin: base, accept: 'text/html' },
		maxRedirects: 0
	});
const waitForCalls = async (count) => {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const stats = await (await fetch(`${provider}/stats`)).json();
		if (stats.active === count) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error('Provider calls did not overlap');
};

try {
	const admin = await context();
	assert.equal(
		(await login(admin, 'admin@llm.fixture', 'disposable-llm-admin-password')).status(),
		303
	);
	const saved = await post(admin, '/api/admin/llm/save', {
		id: null,
		expectedVersion: null,
		settings: {
			name: 'Concurrency fixture',
			provider: 'ollama',
			endpoint: internalProvider,
			model: 'fixture-model',
			enabled: true,
			temperature: 0.5,
			topP: 0.95,
			maxOutputTokens: 4096,
			requestTimeoutSeconds: 30,
			generationTimeoutSeconds: 60,
			batchSize: 3,
			maxConcurrentOperations: 3
		},
		credential: { action: 'remove' }
	});
	assert.equal(saved.status(), 200);
	const configuration = (await saved.json()).configuration;
	const selection = (await (await admin.get(`${base}/api/admin/llm`)).json()).selection;
	assert.equal(
		(
			await post(admin, '/api/admin/llm/select', {
				id: configuration.id,
				expectedConfigurationVersion: configuration.version,
				expectedSelectionVersion: selection.version
			})
		).status(),
		200
	);
	const teachers = [];
	for (let index = 0; index < 6; index++) {
		const email = `teacher-${Date.now()}-${index}@concurrency.fixture`;
		const password = `disposable-teacher-password-${index}`;
		assert.equal(
			(await post(admin, '/api/admin/users', { email, password, role: 'TEACHER' })).status(),
			201
		);
		const client = await context();
		assert.equal((await login(client, email, password)).status(), 303);
		const creationId = crypto.randomUUID();
		assert.equal(
			(
				await post(client, '/api/creations', {
					uniqueId: creationId,
					versionId: 0,
					lastEdited: 1,
					config: { title: `Concurrency fixture ${index}`, slides: [] }
				})
			).status(),
			201
		);
		teachers.push({ client, creationId });
	}
	const generate = (teacher, operationId, topic) =>
		post(teacher.client, '/api/ai/activities', {
			operationId,
			creationId: teacher.creationId,
			activityType: 'word_cloud',
			topic,
			instructions: '',
			language: 'en',
			itemCount: 1
		});
	const firstId = crypto.randomUUID();
	const first = generate(teachers[0], firstId, 'Concurrency hold one');
	const second = generate(teachers[1], crypto.randomUUID(), 'Concurrency hold two');
	const third = generate(teachers[2], crypto.randomUUID(), 'Concurrency hold three');
	await waitForCalls(3);
	assert.equal((await generate(teachers[3], crypto.randomUUID(), 'Colors')).status(), 409);
	assert.equal((await generate(teachers[0], crypto.randomUUID(), 'Colors')).status(), 409);
	assert.deepEqual(
		await (
			await post(teachers[1].client, '/api/ai/activities/cancel', { operationId: firstId })
		).json(),
		{ cancelled: false }
	);
	assert.deepEqual(
		await (
			await post(teachers[0].client, '/api/ai/activities/cancel', { operationId: firstId })
		).json(),
		{ cancelled: true }
	);
	assert.equal((await first).status(), 408);
	const secondResponse = await second;
	assert.equal(secondResponse.status(), 200);
	assert.equal((await secondResponse.json()).drafts.length, 1);
	assert.equal((await generate(teachers[2], crypto.randomUUID(), 'Colors')).status(), 200);
	assert.equal((await third).status(), 200);
	assert.equal((await (await fetch(`${provider}/stats`)).json()).maxActive, 3);
	const lowered = await post(admin, '/api/admin/llm/save', {
		id: configuration.id,
		expectedVersion: configuration.version,
		settings: { ...configuration, maxConcurrentOperations: 1 },
		credential: { action: 'keep' }
	});
	assert.equal(lowered.status(), 200);
	const loweredConfiguration = (await lowered.json()).configuration;
	assert.equal(loweredConfiguration.maxConcurrentOperations, 1);
	const single = generate(teachers[0], crypto.randomUUID(), 'Concurrency hold single');
	await waitForCalls(1);
	assert.equal(
		(
			await post(admin, '/api/admin/llm/test', {
				id: configuration.id,
				expectedVersion: loweredConfiguration.version,
				settings: loweredConfiguration,
				credential: { action: 'keep' }
			})
		).status(),
		409
	);
	assert.equal((await post(teachers[0].client, '/api/admin/llm/save', {})).status(), 403);
	assert.equal((await generate(teachers[1], crypto.randomUUID(), 'Colors')).status(), 409);
	assert.equal((await single).status(), 200);
	assert.equal((await generate(teachers[1], crypto.randomUUID(), 'Colors')).status(), 200);
	const raised = await post(admin, '/api/admin/llm/save', {
		id: configuration.id,
		expectedVersion: loweredConfiguration.version,
		settings: { ...loweredConfiguration, maxConcurrentOperations: 5 },
		credential: { action: 'keep' }
	});
	assert.equal(raised.status(), 200);
	for (const count of [4, 5, 6]) {
		const pending = teachers
			.slice(0, count)
			.map((teacher) => generate(teacher, crypto.randomUUID(), 'Concurrency hold matrix'));
		await waitForCalls(Math.min(count, 5));
		const responses = await Promise.all(pending);
		assert.equal(
			responses.filter((response) => response.status() === 200).length,
			Math.min(count, 5)
		);
		assert.equal(
			responses.filter((response) => response.status() === 409).length,
			Math.max(0, count - 5)
		);
		for (const response of responses) {
			const body = await response.json();
			if (response.status() === 200) assert.equal(body.drafts.length, 1);
			else assert.equal(body.error, 'ai_busy');
		}
		console.log(
			`PASS limit 5: ${count} simultaneous users, ${Math.min(count, 5)} accepted, ${Math.max(0, count - 5)} busy.`
		);
	}
	assert.equal((await generate(teachers[5], crypto.randomUUID(), 'Colors')).status(), 200);
	assert.equal((await (await fetch(`${provider}/stats`)).json()).maxActive, 5);
	console.log(
		'PASS configured limit 3: three overlapping calls, fourth rejected, isolated cancellation; saving limit 1 immediately changes admission without restart.'
	);
} finally {
	await Promise.all(contexts.map((client) => client.dispose()));
}
