// Node 24 + Playwright, against nginx.compose.yml only. Never targets live data.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { chromium, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:9399';
const basePath = process.env.BASE_PATH ?? '/SEQuiz';
assert(/^(\/[A-Za-z0-9_-]+)+$/.test(basePath) && basePath.trim() === basePath);
const base = origin + basePath;
const wsBase = origin.replace(/^http/, 'ws') + basePath;
const startedAt = new Date().toISOString();
assert.equal(process.env.ACCEPTANCE_URL ?? base, base);
const m = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
const output = new URL(`../../test-results/nginx/${Date.now()}/`, import.meta.url);
mkdirSync(output, { recursive: true });
const pixel = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
	'base64'
);
// A valid ancillary text chunk keeps the image tiny while exceeding adapter-node's 512-KiB default.
const metadata = Buffer.concat([Buffer.from('fixture\0'), Buffer.alloc(600 * 1024, 97)]);
const chunk = Buffer.alloc(metadata.length + 12);
chunk.writeUInt32BE(metadata.length);
chunk.write('tEXt', 4);
metadata.copy(chunk, 8);
chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
const image = Buffer.concat([pixel.subarray(0, -12), chunk, pixel.subarray(-12)]);
assert(image.length > 512 * 1024 && image.length < 5 * 1024 * 1024);
const browser = await chromium.launch({
	headless: true,
	executablePath:
		process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
const checks = [];
const pageErrors = [];
const consoleErrors = [];
const externalFontErrors = [];
const resourceErrors = [];
const escapedRequests = [];
const websocketUrls = [];
const pgadminLogoutDenials = [];
const sockets = new Set();

async function api(context, path, options = {}, status = 200) {
	const response = await context.request.fetch(base + path, {
		...options,
		headers: { origin, ...options.headers },
		maxRedirects: 0
	});
	assert.equal(response.status(), status, `${options.method ?? 'GET'} ${path}`);
	return response;
}
async function login(context, email, password) {
	await api(
		context,
		'/en/login',
		{
			method: 'POST',
			headers: { accept: 'text/html' },
			form: { email, password, returnTo: basePath + '/en/create' }
		},
		303
	);
}
function monitor(page) {
	const messages = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const url = message.location().url;
		if (
			url.startsWith('https://fonts.googleapis.com/') &&
			message.text().includes('ERR_CONNECTION_CLOSED')
		)
			externalFontErrors.push({ url, error: message.text() });
		else consoleErrors.push(message.text());
	});
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (
			url.origin === origin &&
			url.pathname !== basePath &&
			!url.pathname.startsWith(basePath + '/')
		)
			escapedRequests.push(url.pathname);
	});
	page.on('response', (response) => {
		if (response.status() >= 400)
			resourceErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
	});
	page.on('websocket', (socket) => {
		websocketUrls.push(socket.url());
		socket.on('framereceived', ({ payload }) => messages.push(JSON.parse(payload.toString())));
	});
	return messages;
}
async function links(page) {
	const urls = await page.locator('[href], [src], form[action]').evaluateAll((elements) =>
		elements.flatMap((element) =>
			['href', 'src', 'action'].flatMap((attribute) => {
				const value = element.getAttribute(attribute);
				return value && !value.startsWith('#') ? [new URL(value, location.href).href] : [];
			})
		)
	);
	for (const value of urls) {
		const url = new URL(value);
		if (url.origin === origin) {
			assert(url.pathname.startsWith(basePath + '/'), `Escaped link: ${url.pathname}`);
			assert(!url.pathname.includes(basePath + basePath), `Repeated prefix: ${url.pathname}`);
		}
	}
}
async function connect(code, watcher = 'new') {
	const socket = new WebSocket(`${wsBase}/backend/watch/${code}/${watcher}`);
	sockets.add(socket);
	const queue = [];
	const messages = [];
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);
		messages.push(message);
		queue.push(message);
	});
	socket.addEventListener('close', () => queue.push({ closed: true }));
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
		socket.addEventListener(
			'open',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
		socket.addEventListener(
			'error',
			() => {
				clearTimeout(timer);
				reject(new Error('WebSocket connection failed'));
			},
			{ once: true }
		);
	});
	return {
		messages,
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
			throw new Error('Expected WebSocket event not received');
		}
	};
}

try {
	const pgadmin = await browser.newContext();
	const pgadminRedirect = await pgadmin.request.get(origin + '/pgadmin?check=1', {
		maxRedirects: 0
	});
	assert.equal(pgadminRedirect.status(), 308);
	assert.equal(pgadminRedirect.headers().location, '/pgadmin/?check=1');
	const pgadminLogin = await pgadmin.request.get(origin + '/pgadmin/', {
		maxRedirects: 0,
		headers: {
			'X-Script-Name': '/spoofed',
			'X-Scheme': 'https',
			'X-Forwarded-Host': 'wrong.invalid',
			'X-Forwarded-Port': '443',
			'X-Forwarded-Prefix': '/spoofed'
		}
	});
	assert.equal(pgadminLogin.status(), 302);
	const pgadminLocation = new URL(pgadminLogin.headers().location, origin);
	assert.equal(pgadminLocation.origin, origin);
	assert.equal(pgadminLocation.pathname, '/pgadmin/login');
	const pgadminPage = await pgadmin.newPage();
	const pgadminErrors = [];
	let pgadminLoggingOut = false;
	pgadminPage.on('pageerror', (error) => pgadminErrors.push(error.message));
	pgadminPage.on('response', (response) => {
		const path = new URL(response.url()).pathname;
		if (
			pgadminLoggingOut &&
			response.status() === 401 &&
			path === '/pgadmin/settings/get_tree_state/'
		)
			pgadminLogoutDenials.push(path);
		else if (response.status() >= 400) pgadminErrors.push(`${response.status()} ${response.url()}`);
	});
	await pgadminPage.goto(origin + '/pgadmin/');
	await expect(pgadminPage.locator('input[name="email"]')).toBeVisible();
	const pgadminAssets = await pgadminPage
		.locator('script[src], link[rel="stylesheet"]')
		.evaluateAll((elements) => elements.map((element) => element.src || element.href));
	assert(pgadminAssets.length > 0);
	for (const value of pgadminAssets) {
		const url = new URL(value);
		assert.equal(url.origin, origin);
		assert(url.pathname.startsWith('/pgadmin/'), `Escaped pgAdmin asset: ${url.pathname}`);
	}
	await pgadminPage.locator('input[name="email"]').fill('admin@nginx.fixture');
	await pgadminPage.locator('input[name="password"]').fill('disposable-nginx-pgadmin-password');
	await pgadminPage.locator('input[type="submit"], button[type="submit"]').click();
	await pgadminPage.waitForURL(origin + '/pgadmin/browser/');
	await expect(pgadminPage.locator('#root')).toBeVisible();
	await expect(pgadminPage.locator('#root')).not.toBeEmpty();
	await pgadminPage.screenshot({ path: fileURLToPath(new URL('pgadmin.png', output)) });
	assert.deepEqual(pgadminErrors, []);
	// The tree's in-flight request may be rejected after the session is deliberately removed.
	pgadminLoggingOut = true;
	await pgadminPage.goto(origin + '/pgadmin/logout');
	await expect(pgadminPage.locator('input[name="email"]')).toBeVisible();
	assert(new URL(pgadminPage.url()).pathname.startsWith('/pgadmin/'));
	assert.deepEqual(pgadminErrors, []);
	await pgadmin.close();
	checks.push(
		'pgAdmin prefix/query redirect, spoofed proxy headers, browser assets and login/logout'
	);

	const anonymous = await browser.newContext();
	const wrongCase =
		basePath === basePath.toLowerCase() ? basePath.toUpperCase() : basePath.toLowerCase();
	for (const path of [
		'/',
		wrongCase + '/',
		'/api/account',
		'/admin-api/publications',
		'/backend/hello',
		...(basePath !== '/SEQuiz' ? ['/SEQuiz/'] : [])
	])
		assert.equal((await anonymous.request.get(origin + path)).status(), 404, path);
	const canonical = await anonymous.request.get(base + '?check=1', { maxRedirects: 0 });
	assert.equal(canonical.status(), 308);
	assert.equal(new URL(canonical.headers().location, origin).origin, origin);
	assert.equal(new URL(canonical.headers().location, origin).pathname, basePath + '/');
	assert.equal(new URL(canonical.headers().location, origin).search, '?check=1');
	for (const path of [
		'/api/account',
		'/api/creations',
		'/admin-api/publications',
		'/admin-api/games/active'
	])
		await api(anonymous, path, {}, 401);
	await api(anonymous, '/api/add', { method: 'POST', data: {} }, 401);
	for (const path of [
		'/api/host/authorize',
		'/api/host/completed',
		'/en/api/host/authorize',
		'/th/api/host/completed',
		'/backend/add',
		'/media/delete',
		'/backend/internal/host/revoke',
		'/backend/hello',
		'/media/thumbnail'
	])
		await api(anonymous, path, { method: 'POST', data: {} }, 404);
	await api(anonymous, '/en/api/account', {}, 404);
	const sitemap = await (await api(anonymous, '/sitemap.xml')).text();
	const sitemapUrls = [...sitemap.matchAll(/(?:<loc>|href=")([^<"]+)/g)].map((match) => match[1]);
	assert(sitemapUrls.length > 0);
	for (const value of sitemapUrls) {
		const url = new URL(value);
		if (url.origin === origin) assert(url.pathname.startsWith(basePath + '/'), value);
	}
	const protectedPage = await api(anonymous, '/en/create', {}, 303);
	const redirect = new URL(protectedPage.headers().location, origin);
	assert.equal(redirect.pathname, basePath + '/en/login');
	assert.equal(redirect.searchParams.get('returnTo'), basePath + '/en/create');
	checks.push(
		'case-sensitive prefix, query-preserving slash redirect, unauthorized APIs, hidden callbacks'
	);

	const page = await anonymous.newPage();
	monitor(page);
	for (const path of ['/', '/th/', '/en/', '/en/login']) {
		await page.goto(base + path);
		await expect(page.locator('body')).toBeVisible();
		await links(page);
		assert(
			(await page.locator('script[src], link[rel="modulepreload"]').count()) > 0,
			`${path}: JavaScript assets`
		);
	}
	for (const width of [1440, 768, 375]) {
		await page.setViewportSize({ width, height: 960 });
		for (const locale of ['', '/en']) {
			await page.goto(base + locale + '/');
			await expect(page.locator('header').first()).toBeVisible();
			assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
			await page.screenshot({
				path: fileURLToPath(new URL(`home-${locale ? 'en' : 'th'}-${width}.png`, output)),
				fullPage: true
			});
		}
	}
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto(base + '/en/');
	await page.locator('button[popovertarget="mainheader"]').click();
	await page.locator('#mainheader button[lang="th"]').click();
	await page.waitForURL(base + '/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'th');
	await page.locator('button[popovertarget="mainheader"]').click();
	await page.locator('#mainheader button[lang="en"]').click();
	await page.waitForURL((url) => [basePath + '/en', basePath + '/en/'].includes(url.pathname));
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	checks.push('prefixed sitemap, locale switching, root pages at 1440/768/375 without overflow');
	await page.goto(base + '/en/login?returnTo=' + encodeURIComponent(basePath + '/en/create'));
	await page.locator('#email').fill('admin@nginx.fixture');
	await page.locator('#password').fill('disposable-nginx-admin-password');
	await page.getByRole('button', { name: m.login, exact: true }).click();
	await page.waitForURL(base + '/en/create');
	const admin = anonymous;
	for (const path of [
		'/api/admin/users',
		'/api/admin/publications',
		'/admin-api/publications',
		'/admin-api/games/active'
	])
		await api(admin, path);
	for (const path of ['/en/admin/users', '/th/admin/llm']) {
		await page.goto(base + path);
		await expect(page.locator('h1').first()).toBeVisible();
		await links(page);
	}
	await api(
		admin,
		'/api/admin/users',
		{
			method: 'POST',
			headers: { origin: 'https://wrong.invalid' },
			data: {}
		},
		403
	);
	checks.push(
		'Thai/English pages and browser assets, real login form, ADMIN API aliases and exact-origin CSRF'
	);

	const suffix = crypto.randomUUID().slice(0, 8);
	const email = `teacher-${suffix}@nginx.fixture`;
	const password = 'disposable-nginx-teacher-password';
	await api(admin, '/api/admin/users', { method: 'POST', data: { email, password } }, 201);
	const teacher = await browser.newContext({ viewport: { width: 1440, height: 960 } });
	await teacher.grantPermissions(['clipboard-read', 'clipboard-write']);
	await login(teacher, email, password);
	await api(teacher, '/admin-api/publications', {}, 403);
	await api(teacher, '/en/admin/users', {}, 403);
	const editor = await teacher.newPage();
	const hostMessages = monitor(editor);
	await editor.goto(base + '/en/create');
	const creationResponse = editor.waitForResponse(
		(response) =>
			response.url() === base + '/api/creations' && response.request().method() === 'POST'
	);
	await editor.getByRole('button', { name: m.start_blank, exact: true }).first().click();
	const created = await creationResponse;
	assert.equal(created.status(), 201);
	const creationId = created.request().postDataJSON().uniqueId;
	await editor.waitForURL(new RegExp(`${basePath}/en/quiz/\\d+/edit$`));
	const editUrl = editor.url();
	const title = `Prefix acceptance ${suffix}`;
	await editor.locator('#title').fill(title);
	await editor.locator('#add-button button').click();
	await editor.locator('.slide-type').filter({ hasText: m.true_or_false }).click();
	await editor.locator('#question_title').fill('Prefix URLs stay on the same origin');
	const privateUpload = editor.waitForResponse(
		(response) =>
			response.url().startsWith(base + '/api/host/media/') && response.request().method() === 'PUT'
	);
	await editor.locator('input[name="image_input"]').first().setInputFiles({
		name: 'fixture.png',
		mimeType: 'image/png',
		buffer: image
	});
	assert.equal((await privateUpload).status(), 200);
	const record = async () =>
		(await (await api(teacher, '/api/creations/' + creationId)).json()).record;
	await expect.poll(async () => (await record()).config.title).toBe(title);
	await expect
		.poll(
			async () =>
				(await record()).config.slides[0]?.MultipleChoice?.media?.Image?.HashReference?.hash
		)
		.toBeTruthy();
	const saved = await record();
	const hash = saved.config.slides[0].MultipleChoice.media.Image.HashReference.hash;
	await api(admin, '/api/creations/' + creationId, {}, 404);
	await api(admin, '/api/host/media/' + hash, {}, 404);
	const guest = await browser.newContext();
	await api(guest, '/api/host/media/' + hash, {}, 401);
	await editor.reload();
	await expect(editor.locator('#title')).toHaveValue(title);
	await expect(editor.locator('img.image').first()).toBeVisible();
	assert(
		await editor
			.locator('img.image')
			.first()
			.evaluate((element) => element.naturalWidth > 0)
	);
	await links(editor);
	await editor.screenshot({
		path: fileURLToPath(new URL('editor.png', output)),
		fullPage: true
	});
	checks.push(
		'real browser creation, title autosave, private image upload, reload/display and owner isolation'
	);

	const shareResponse = editor.waitForResponse(
		(response) =>
			(new URL(response.url()).pathname === basePath + '/en/share' &&
				response.request().method() === 'PUT') ||
			(new URL(response.url()).pathname === basePath + '/share' &&
				response.request().method() === 'PUT')
	);
	await editor.getByRole('button', { name: m.share, exact: true }).click();
	assert.equal((await shareResponse).status(), 200);
	await expect
		.poll(async () => {
			const link = await editor.evaluate(() => navigator.clipboard.readText());
			return link.startsWith(base + '/en/share/') || link.startsWith(base + '/share/');
		})
		.toBe(true);
	const sharedUrl = await editor.evaluate(() => navigator.clipboard.readText());
	assert(!sharedUrl.includes(basePath + basePath));
	assert.equal((await guest.request.get(sharedUrl)).status(), 200);

	await editor.getByRole('button', { name: m.host, exact: true }).click();
	await editor.waitForURL(new RegExp(`${basePath}/en/quiz/\\d+/host$`));
	const runtimeUpload = editor.waitForResponse(
		(response) =>
			response.url() === base + '/media/upload' && response.request().method() === 'POST'
	);
	const roomResponse = editor.waitForResponse((response) => response.url() === base + '/api/add');
	await editor.locator('.start-row button').click();
	const uploaded = await runtimeUpload;
	assert.equal(uploaded.status(), 200);
	const mediaId = await uploaded.json();
	const displayed = await api(guest, '/media/get/' + mediaId);
	assert.match(displayed.headers()['content-type'], /^image\/png/);
	assert((await displayed.body()).byteLength > 0);
	const room = await (await roomResponse).json();
	await editor.waitForURL(new RegExp(`${basePath}/en/host/${room.game_id}$`));
	await expect(editor.locator('.code-value')).toHaveText(room.game_id);
	await editor.locator('.code-button').click();
	await expect
		.poll(() => editor.evaluate(() => navigator.clipboard.readText()))
		.toBe(`${base}/en/play?code=${room.game_id}`);
	const joinUrl = await editor.evaluate(() => navigator.clipboard.readText());
	const player = await guest.newPage();
	monitor(player);
	await player.goto(joinUrl);
	await player.locator('#name').fill('Prefix learner');
	await player.getByRole('button', { name: m.lets_start, exact: true }).click();
	await expect(editor.getByText('Prefix learner', { exact: true })).toBeVisible();
	await links(editor);
	assert.equal(await (await api(guest, '/backend/alive/' + room.game_id)).json(), true);
	await api(
		admin,
		`/api/host/games/${room.game_id}/authorization`,
		{ method: 'POST', data: {} },
		404
	);
	const intruder = await connect(room.game_id);
	intruder.send({ Host: 'End' });
	await intruder.until((message) => message.closed);
	assert.equal(await (await api(guest, '/backend/alive/' + room.game_id)).json(), true);
	assert(
		websocketUrls.filter((url) => url.startsWith(`${wsBase}/backend/watch/${room.game_id}/`))
			.length >= 2
	);
	checks.push(
		'generated share/join links, runtime media upload/read, browser host/anonymous join over proxied WebSockets, unowned host denied'
	);
	await editor.getByRole('button', { name: m.start, exact: true }).click();
	await expect
		.poll(() => hostMessages.some((message) => message.MultipleChoice?.AnswersAnnouncement), {
			timeout: 15000
		})
		.toBe(true);
	await player.getByRole('button', { name: m.strawberry, exact: true }).click();
	await expect
		.poll(() => hostMessages.some((message) => message.MultipleChoice?.AnswersResults))
		.toBe(true);
	const browserResult = hostMessages.findLast((message) => message.MultipleChoice?.AnswersResults);
	assert.equal(
		browserResult.MultipleChoice.AnswersResults.results.reduce(
			(total, { count }) => total + count,
			0
		),
		1
	);
	await editor.getByRole('button', { name: m.skip, exact: true }).click();
	await expect.poll(() => hostMessages.some((message) => message.Game?.Leaderboard)).toBe(true);
	await editor.getByRole('button', { name: m.skip, exact: true }).click();
	await expect.poll(() => hostMessages.some((message) => message.Game?.Summary)).toBe(true);
	await expect
		.poll(async () =>
			(
				await teacher.request.post(`${base}/api/host/games/${room.game_id}/authorization`, {
					headers: { origin },
					data: {}
				})
			).status()
		)
		.toBe(404);
	checks.push(
		'browser player answers, host advances results/leaderboard/summary, signed prefixed completion persists'
	);
	const saveReportResponse = editor.waitForResponse(
		(response) => response.url() === base + '/api/reports' && response.request().method() === 'POST'
	);
	await editor.getByRole('button', { name: m.save_report, exact: true }).click();
	const persistedReport = await saveReportResponse;
	assert.equal(persistedReport.status(), 201);
	const { record: reportRecord } = await persistedReport.json();
	assert.equal(reportRecord.title, title);
	assert.equal(reportRecord.gameInstanceId, room.instance_id);
	assert.equal(reportRecord.fuizUniqueId, creationId);
	assert.equal(reportRecord.playerCount, 1);
	assert.equal(reportRecord.questions.length, 1);
	assert.equal(reportRecord.questions[0].title, 'Prefix URLs stay on the same origin');
	assert.equal(reportRecord.questions[0].type, 'MultipleChoice');
	assert.equal(reportRecord.questions[0].correct, 1);
	assert.equal(reportRecord.questions[0].wrong, 0);
	assert.equal(reportRecord.results[0][0], 'Prefix learner');
	assert(reportRecord.results[0][1][0] > 0);
	await editor.getByRole('link', { name: m.view_report, exact: true }).click();
	await editor.waitForURL((url) => url.pathname.startsWith(basePath + '/en/reports/'));
	await editor.reload();
	await expect(
		editor.getByText('Prefix URLs stay on the same origin', { exact: true }).first()
	).toBeVisible();
	await expect(editor.getByText('Prefix learner', { exact: true }).first()).toBeVisible();
	assert.deepEqual(
		(await (await api(teacher, '/api/reports/' + reportRecord.uniqueId)).json()).record,
		reportRecord
	);
	await api(admin, '/api/reports/' + reportRecord.uniqueId, {}, 404);
	await api(guest, '/api/reports/' + reportRecord.uniqueId, {}, 401);
	// A fresh browser context has no IndexedDB cache; the report must reload from the server.
	const reopened = await browser.newContext({ viewport: { width: 1440, height: 960 } });
	await reopened.addCookies(await teacher.cookies());
	const reportPage = await reopened.newPage();
	monitor(reportPage);
	await reportPage.goto(base + '/en/reports');
	await reportPage.getByRole('link', { name: new RegExp(title) }).click();
	await expect(
		reportPage.getByText('Prefix URLs stay on the same origin', { exact: true }).first()
	).toBeVisible();
	await expect(reportPage.getByText('Prefix learner', { exact: true }).first()).toBeVisible();
	await reportPage.screenshot({
		path: fileURLToPath(new URL('report-reopened.png', output)),
		fullPage: true
	});
	await links(reportPage);
	await reopened.close();
	checks.push(
		'browser report save, reload and reopen with empty IndexedDB through Nginx; question, score, instance linkage and ownership persist'
	);

	const completedRoom = await (
		await api(teacher, '/api/add', {
			method: 'POST',
			data: {
				config: {
					title: 'Normal prefix completion',
					slides: [
						{
							MultipleChoice: {
								title: 'Continue and complete normally',
								introduce_slide: 0,
								introduce_question: 0,
								time_limit: 5000,
								points_awarded: 1000,
								answers: [
									{ content: { Text: 'True' }, correct: true },
									{ content: { Text: 'False' }, correct: false }
								]
							}
						}
					]
				},
				options: { random_names: null, show_answers: true, no_leaderboard: true, teams: null },
				origin: { uniqueId: creationId, versionId: saved.versionId }
			}
		})
	).json();
	const scope = await (
		await api(teacher, `/api/host/games/${completedRoom.game_id}/authorization`, {
			method: 'POST',
			data: {}
		})
	).json();
	const owner = await connect(completedRoom.game_id, scope.watcherId);
	owner.send({ Authorization: scope.grant });
	owner.send({ Ghost: { ClaimId: scope.watcherId } });
	await owner.until((message) => message.Game?.WaitingScreen);
	await expect.poll(() => owner.messages.some((message) => message.Game?.HostTimeout)).toBe(true);
	const generation = owner.messages.findLast((message) => message.Game?.HostTimeout).Game
		.HostTimeout.generation;
	owner.send({ Host: 'Continue' });
	const continued = await owner.until(
		(message) => message.Game?.HostTimeout?.generation > generation
	);
	assert.equal(continued.Game.HostTimeout.warning, false);
	const learner = await connect(completedRoom.game_id);
	learner.send({ Ghost: 'DemandId' });
	await learner.until((message) => message.Game?.IdAssign);
	learner.send({ Unassigned: { NameRequest: 'Completion learner' } });
	await learner.until((message) => message.Game?.NameAssign);
	owner.send({ Host: { Next: 'Lobby' } });
	await learner.until((message) => message.MultipleChoice?.AnswersAnnouncement);
	learner.send({ Player: { IndexAnswer: 0 } });
	const result = await owner.until((message) => message.MultipleChoice?.AnswersResults);
	assert.deepEqual(
		result.MultipleChoice.AnswersResults.results.map(({ count }) => count),
		[1, 0]
	);
	owner.send({
		Host: { Next: { Slide: { MultipleChoice: { index: 0, phase: 'AnswersResults' } } } }
	});
	await owner.until((message) => message.Game?.Summary);
	await learner.until((message) => message.Game?.Summary);
	await expect
		.poll(async () =>
			(
				await teacher.request.post(
					`${base}/api/host/games/${completedRoom.game_id}/authorization`,
					{
						headers: { origin },
						data: {},
						maxRedirects: 0
					}
				)
			).status()
		)
		.toBe(404);
	assert.equal(await (await api(guest, '/backend/alive/' + completedRoom.game_id)).json(), false);
	checks.push(
		'real WS Continue/answer/results/normal completion; prefixed signed completion persisted (host binding no longer active)'
	);

	const staleCookies = (await teacher.cookies())
		.map(({ name, value }) => `${name}=${value}`)
		.join('; ');
	await editor.goto(editUrl);
	await expect(editor.locator('#title')).toHaveValue(title);
	const logoutTab = await teacher.newPage();
	monitor(logoutTab);
	await logoutTab.goto(base + '/en/');
	await expect(logoutTab.locator('.logout-form')).toHaveAttribute(
		'action',
		basePath + '/en/logout'
	);
	await logoutTab.getByRole('button', { name: m.log_out, exact: true }).click();
	await expect.poll(async () => (await api(teacher, '/api/account', {}, 401)).status()).toBe(401);
	await api(guest, '/api/account', { headers: { cookie: staleCookies } }, 401);
	await expect(editor.locator('#title')).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveText(m.private_session_error);
	const expiredLogin = editor.getByRole('link', { name: m.admin_login_title, exact: true });
	const expiredLoginUrl = new URL(await expiredLogin.getAttribute('href'), origin);
	assert.equal(expiredLoginUrl.pathname, basePath + '/en/login');
	assert.equal(expiredLoginUrl.searchParams.get('returnTo'), new URL(editUrl).pathname);
	await editor.goto(editUrl);
	await editor.waitForURL(new RegExp(`${basePath}/en/login\\?`));
	assert.equal(new URL(editor.url()).searchParams.get('returnTo'), new URL(editUrl).pathname);
	await api(admin, '/en/admin/logout', { method: 'POST', headers: { accept: 'text/html' } }, 303);
	await api(admin, '/api/account', {}, 401);
	checks.push(
		'cross-tab prefixed POST logout hides private editor; login link/return URL preserved; revoked cookie and ADMIN logout alias'
	);
	assert.deepEqual(pageErrors, []);
	assert.deepEqual(consoleErrors, []);
	assert.deepEqual(resourceErrors, []);
	assert.deepEqual(escapedRequests, []);
	const evidence = {
		basePath,
		startedAt,
		completedAt: new Date().toISOString(),
		browserVersion: browser.version(),
		nodeVersion: process.version,
		platform: process.platform,
		checks,
		pageErrors,
		consoleErrors,
		externalFontErrors,
		resourceErrors,
		escapedRequests,
		websocketUrls,
		pgadminLogoutDenials
	};
	writeFileSync(new URL('results.json', output), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence, null, 2));
} finally {
	for (const socket of sockets) socket.close();
	await browser.close();
}
