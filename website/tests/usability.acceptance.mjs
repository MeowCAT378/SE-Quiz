// Disposable auth.compose.yml stack only; never target live accounts.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:9397';
const screenshotDirectory = process.env.USABILITY_SCREENSHOT_DIR
	? resolve(process.env.USABILITY_SCREENSHOT_DIR)
	: fileURLToPath(new URL('../../test-results/usability/', import.meta.url));
mkdirSync(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({ headless: process.env.USABILITY_HEADED !== '1' });
const checks = [];
try {
	const context = await browser.newContext({ timezoneId: 'Asia/Bangkok', acceptDownloads: true });
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const login = await context.request.post(base + '/login', {
		headers: { origin: base, accept: 'text/html' },
		form: { email: 'admin@acceptance.test', password: 'disposable-admin-password' },
		maxRedirects: 0
	});
	assert.equal(login.status(), 303);
	const suffix = crypto.randomUUID().slice(0, 8);
	const user = await context.request.post(base + '/api/admin/users', {
		headers: { origin: base },
		data: {
			email: `usability-${suffix}@acceptance.test`,
			password: 'disposable-usability-password'
		}
	});
	assert.equal(user.status(), 201);
	await context.request.post(base + '/login', {
		headers: { origin: base, accept: 'text/html' },
		form: {
			email: `usability-${suffix}@acceptance.test`,
			password: 'disposable-usability-password'
		},
		maxRedirects: 0
	});
	for (const [title, date] of [
		['English quiz', '2026-09-19T23:59:59.999+07:00'],
		['ภาษาไทย', '2026-09-18T12:00:00+07:00'],
		['Invalid quiz', '2026-09-20T12:00:00+07:00']
	]) {
		const timestamp = Date.parse(date);
		const response = await context.request.post(base + '/api/creations', {
			headers: { origin: base },
			data: {
				uniqueId: crypto.randomUUID(),
				versionId: 0,
				lastEdited: timestamp,
				config: { title, slides: [{ InfoSlide: { title: title === 'Invalid quiz' ? '' : title } }] }
			}
		});
		assert.equal(response.status(), 201);
		const room = await context.request.post(base + '/api/add', {
			headers: { origin: base },
			data: {
				config: {
					title,
					slides: [
						{
							MultipleChoice: {
								title: 'Acceptance question',
								points_awarded: 1000,
								answers: [
									{ content: { Text: 'Yes' }, correct: true },
									{ content: { Text: 'No' }, correct: false }
								]
							}
						}
					]
				},
				options: { random_names: null, show_answers: true, no_leaderboard: false, teams: null }
			}
		});
		assert.equal(room.status(), 200);
		const game = await room.json();
		const report = await context.request.post(base + '/api/reports', {
			headers: { origin: base },
			data: {
				uniqueId: crypto.randomUUID(),
				versionId: 0,
				lastEdited: timestamp,
				playedAt: timestamp,
				gameInstanceId: game.instance_id,
				gameCode: game.game_id,
				title,
				playerCount: 0,
				questions: [],
				results: []
			}
		});
		assert.equal(report.status(), 201);
	}
	const page = await context.newPage();
	const errors = [];
	const consoleErrors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error' && !message.text().includes('503'))
			consoleErrors.push(message.text());
	});
	async function noOverflow(label) {
		const dimensions = await page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			width: innerWidth
		}));
		assert(dimensions.scroll <= dimensions.width + 1, `${label}: ${JSON.stringify(dimensions)}`);
		const clipped = await page
			.locator('.filters input, .topbar button, .topbar input, .validation button')
			.evaluateAll((items) =>
				items
					.filter((item) => {
						const r = item.getBoundingClientRect();
						return r.left < -1 || r.right > document.documentElement.clientWidth + 1;
					})
					.map((item) => item.outerHTML.slice(0, 100))
			);
		assert.deepEqual(clipped, [], `${label}: clipped controls`);
	}
	for (const lang of ['en', 'th']) {
		const m = JSON.parse(
			readFileSync(new URL(`../messages/${lang}.json`, import.meta.url), 'utf8')
		);
		const prefix = lang === 'en' ? '/en' : '';
		for (const width of [1440, 768, 375]) {
			await page.setViewportSize({ width, height: 960 });
			await page.goto(base + prefix + '/create');
			await page.locator('.entry').nth(2).waitFor();
			const editPath =
				(await page
					.locator('.entry')
					.filter({ hasText: 'Invalid quiz' })
					.locator('a.main')
					.getAttribute('href')) + '/edit';
			await page.locator('.entry button.select').nth(0).click();
			await page.locator('.entry button.select').nth(1).click();
			await page.locator('input[type="search"]').fill(' ENGLISH ');
			await page.waitForFunction(() => document.querySelectorAll('.entry').length === 1);
			assert(await page.locator('.selection-notice').textContent());
			await page.getByRole('button', { name: m.list_clear_filters, exact: true }).click();
			await page.locator('input[type="search"]').fill('ภาษาไทย');
			await page.waitForFunction(() => document.querySelectorAll('.entry').length === 1);
			await page.getByRole('button', { name: m.list_clear_filters, exact: true }).click();
			await noOverflow(`${lang} gallery ${width}`);
			await page.screenshot({
				path: join(screenshotDirectory, `usability-${lang}-gallery-${width}.png`),
				fullPage: true
			});
			await page.goto(base + prefix + '/reports');
			await page.locator('.card').nth(2).waitFor();
			assert.equal(
				await page.getByLabel(m.list_date_from, { exact: true }).getAttribute('placeholder'),
				m.list_date_placeholder
			);
			await page.getByLabel(m.list_date_from, { exact: true }).fill('20/09/2026');
			await page.getByLabel(m.list_date_to, { exact: true }).fill('19/09/2026');
			await page.getByRole('button', { name: m.list_swap_dates, exact: true }).waitFor();
			assert.equal(
				await page.getByLabel(m.list_date_from, { exact: true }).inputValue(),
				'20/09/2026'
			);
			await page.getByRole('button', { name: m.list_swap_dates, exact: true }).press('Space');
			await page.getByLabel(m.list_date_to, { exact: true }).fill('19/09/2026');
			await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
			assert((await page.locator('.card').innerText()).includes('English quiz'));
			await noOverflow(`${lang} reports ${width}`);
			await page.screenshot({
				path: join(screenshotDirectory, `usability-${lang}-reports-${width}.png`),
				fullPage: true
			});
			if (width === 1440) {
				let failing = true;
				await page.route('**/api/reports', (route) =>
					failing
						? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
						: route.continue()
				);
				await page.reload();
				await page.getByRole('alert').waitFor();
				await page.locator('input[type="search"]').fill(' ENGLISH ');
				await page.getByRole('button', { name: m.private_retry, exact: true }).click();
				await page.getByRole('alert').waitFor();
				failing = false;
				await page.getByRole('button', { name: m.private_retry, exact: true }).click();
				await page.locator('.card').waitFor();
				assert.equal(await page.locator('.card').count(), 1);
				assert.equal(await page.locator('input[type="search"]').inputValue(), ' ENGLISH ');
				assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
				await page.unroute('**/api/reports');
				await page.locator('.card').click();
				for (const [label, extension] of [
					[m.export_excel, '.xlsx'],
					[m.download_results, '.csv']
				]) {
					const exportFile = page.waitForEvent('download');
					await page.getByRole('button', { name: label, exact: true }).click();
					assert((await exportFile).suggestedFilename().endsWith(extension));
				}
				checks.push(
					`${lang}: repeated report failure/retry, retained filters/focus, Excel and CSV downloads`
				);
			}
			await page.goto(base + editPath);
			await page.locator('#question_title').waitFor();
			await page.locator('#question_title').fill('');
			await page.locator('.validation').waitFor();
			assert(await page.getByRole('button', { name: m.host, exact: true }).isDisabled());
			await page.getByRole('button', { name: m.editor_go_to_issue, exact: true }).press('Enter');
			assert.equal(await page.evaluate(() => document.activeElement.id), 'question_title');
			assert(await page.getByRole('button', { name: m.ai_generate, exact: true }).isDisabled());
			await noOverflow(`${lang} editor ${width}`);
			await page.screenshot({
				path: join(screenshotDirectory, `usability-${lang}-editor-${width}.png`),
				fullPage: true
			});
			await page.locator('#question_title').fill('Fixed');
			await page.waitForFunction(() => !document.querySelector('.validation'));
			const download = page.waitForEvent('download');
			await page.getByRole('button', { name: m.editor_download_file, exact: true }).click();
			assert((await download).suggestedFilename().endsWith('.toml'));
			if (width === 1440) {
				const shared = page.waitForResponse(
					(response) =>
						new URL(response.url()).pathname === '/share' && response.request().method() === 'PUT'
				);
				await page.getByRole('button', { name: m.share, exact: true }).press('Space');
				const shareResponse = await shared;
				assert.equal(shareResponse.status(), 200);
				const shareId = await shareResponse.json();
				await page.waitForFunction(
					async (id) => (await navigator.clipboard.readText()).endsWith('/share/' + id),
					shareId
				);
				checks.push(`${lang}: share action and clipboard URL`);
			}
			await page.getByRole('button', { name: m.host, exact: true }).click();
			await page.waitForURL(/\/host$/);
			checks.push(
				`${lang} ${width}: gallery search/selection, report dates/swap, editor focus/correction/save/download/start, no overflow`
			);
		}
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(consoleErrors, []);
	console.log(
		JSON.stringify({ checks, pageErrors: errors, unexpectedConsoleErrors: consoleErrors }, null, 2)
	);
} finally {
	await browser.close();
}
