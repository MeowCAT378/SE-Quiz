import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

// Synthetic hostile model output; no provider calls and no real external destination.
const base = 'http://127.0.0.1:9398';
const out = 'test-results/llm/injection-rendering-' + Date.now();
mkdirSync(out, { recursive: true });
const payload = '<img src="https://injection.invalid/probe" onerror="window.__llmInjection=1">';
const browser = await chromium.launch({
	headless: false,
	executablePath:
		process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
try {
	const context = await browser.newContext();
	await context.request.post(base + '/login', {
		form: { email: 'admin@llm.fixture', password: 'disposable-llm-admin-password' },
		headers: { origin: base },
		maxRedirects: 0
	});
	const id = crypto.randomUUID();
	const title = 'Synthetic hostile output ' + Date.now();
	assert.equal(
		(
			await context.request.post(base + '/api/creations', {
				headers: { origin: base },
				data: { uniqueId: id, versionId: 0, lastEdited: 1, config: { title, slides: [] } }
			})
		).status(),
		201
	);
	const page = await context.newPage();
	const errors = [];
	const outbound = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(() => {
		window.__llmInjection = 0;
	});
	await page.route('https://injection.invalid/**', (route) => {
		outbound.push(route.request().url());
		return route.abort();
	});
	await page.route('**/api/ai/activities', (route) =>
		route.fulfill({
			json: {
				operationId: route.request().postDataJSON().operationId,
				resolvedLanguage: 'en',
				drafts: [{ prompt: payload }]
			}
		})
	);
	await page.goto(base + '/create');
	const link = page.getByRole('link', { name: new RegExp(title) });
	await expect(link).toBeVisible();
	await page.goto(base + (await link.getAttribute('href')) + '/edit');
	await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.locator('select').first().selectOption('word_cloud');
	await dialog.locator('#ai-topic').fill('Synthetic hostile output');
	await dialog.getByLabel('Number of items', { exact: true }).fill('1');
	await dialog.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	await expect(dialog.locator('.drafts input').first()).toHaveValue(payload);
	assert.equal(await page.evaluate(() => window.__llmInjection), 0);
	const record = async () =>
		(await (await context.request.get(base + '/api/creations/' + id)).json()).record;
	assert.equal((await record()).config.slides.length, 0);
	await dialog.screenshot({ path: out + '/review.png' });
	await dialog.getByRole('button', { name: 'Add to Activity', exact: true }).click();
	await expect.poll(async () => (await record()).config.slides.length).toBe(1);
	assert.equal((await record()).config.slides[0].FreeText.title, payload);
	await page.reload();
	await expect(page.locator('#question_title')).toHaveValue(payload);
	await expect(page.locator('img[onerror]')).toHaveCount(0);
	assert.equal(await page.evaluate(() => window.__llmInjection), 0);
	assert.deepEqual(outbound, []);
	assert.deepEqual(errors, []);
	await page.screenshot({ path: out + '/saved-editor.png', fullPage: true });
	writeFileSync(
		out + '/results.json',
		JSON.stringify(
			{
				source: 'synthetic response interception, not model refusal evidence',
				payload,
				draftEscaped: true,
				persistedAsText: true,
				reloadedAsText: true,
				scriptExecuted: false,
				outbound,
				pageErrors: errors
			},
			null,
			2
		)
	);
	console.log(
		'PASS hostile HTML stayed text in draft review, Add, autosave and reloaded editor; no script or outbound request. Evidence: ' +
			out
	);
} finally {
	await browser.close();
}
