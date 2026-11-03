import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const base = 'http://127.0.0.1:9398';
const output = new URL(`../../test-results/llm/authoring-${Date.now()}/`, import.meta.url);
mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const browser = await chromium.launch({
	headless: false,
	executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	await context.request.post(`${base}/login`, {
		form: { email: 'admin@llm.fixture', password: 'disposable-llm-admin-password' },
		headers: { origin: base },
		maxRedirects: 0
	});
	const id = crypto.randomUUID(),
		title = `Draft acceptance ${Date.now()}`;
	const created = await context.request.post(`${base}/api/creations`, {
		headers: { origin: base },
		data: { uniqueId: id, versionId: 0, lastEdited: 1, config: { title, slides: [] } }
	});
	expect(created.status()).toBe(201);
	const generated = await context.request.post(`${base}/api/ai/activities`, {
		headers: { origin: base },
		data: {
			operationId: crypto.randomUUID(),
			creationId: id,
			activityType: 'word_cloud',
			topic: 'Colors',
			instructions: '',
			language: 'en',
			itemCount: 10
		}
	});
	expect(generated.status()).toBe(200);
	expect((await generated.json()).drafts).toHaveLength(10);
	const page = await context.newPage();
	await page.goto(`${base}/en/create`);
	await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
	const href = await page.getByRole('link', { name: new RegExp(title) }).getAttribute('href');
	await page.goto(base + href + '/edit');
	await expect(page.getByRole('button', { name: 'Generate with AI', exact: true })).toBeVisible();
	const record = async () =>
		(await (await context.request.get(`${base}/api/creations/${id}`)).json()).record;
	expect((await record()).config.slides).toHaveLength(0);
	await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: /^Activity type/ }).click();
	await dialog.getByRole('option', { name: 'Word Cloud', exact: true }).click();
	await dialog.locator('#ai-topic').fill('Concurrency hold browser cancellation');
	const cancelled = page.waitForResponse(
		(response) => response.url() === base + '/api/ai/activities/cancel',
		{ timeout: 10000 }
	);
	void cancelled.catch(() => undefined);
	await dialog.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	await expect
		.poll(async () => (await (await fetch('http://127.0.0.1:11435/stats')).json()).active)
		.toBe(1);
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	// Chrome may retain an unconsumed keepalive response body; check status and subsequent behavior.
	expect((await cancelled).status()).toBe(200);
	await expect(dialog).toBeHidden();
	// Cancellation is acknowledged before the in-flight provider call has drained.
	await expect
		.poll(async () => (await (await fetch('http://127.0.0.1:11435/stats')).json()).active)
		.toBe(0);
	await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	await expect(dialog.locator('.drafts fieldset')).toHaveCount(0);
	expect((await record()).config.slides).toHaveLength(0);
	await dialog.locator('#ai-topic').fill('Colors');
	await dialog.getByLabel('Number of items', { exact: true }).fill('2');
	await dialog.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Add to Activity', exact: true })).toBeVisible();
	expect((await record()).config.slides).toHaveLength(0);
	await expect(dialog.locator('#ai-topic')).toBeDisabled();
	await dialog.getByRole('button', { name: 'Remove', exact: true }).first().click();
	await expect(dialog.locator('.drafts fieldset')).toHaveCount(1);
	await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Add to Activity', exact: true })).toHaveCount(0);
	await expect(dialog.locator('#ai-topic')).toBeEnabled();
	await dialog.getByRole('button', { name: 'Generate with AI', exact: true }).click();
	await expect(dialog.locator('.drafts fieldset')).toHaveCount(2);
	await dialog.locator('.drafts input').first().fill('Reviewed classroom prompt');
	await dialog.getByRole('button', { name: 'Add to Activity', exact: true }).click();
	await expect.poll(async () => (await record()).config.slides.length).toBe(2);
	const final = await record();
	expect(final.config.title).toBe(title);
	expect(JSON.stringify(final.config)).toContain('Reviewed classroom prompt');
	console.log(
		'PASS 10 API drafts; browser cancellation, draft removal/regeneration and setting locks; no persistence before Add; 2 reviewed drafts persisted through ordinary autosave.'
	);
	const snapshot = await (await context.request.get(`${base}/api/admin/llm`)).json();
	const active = snapshot.configurations.find((c) => c.id === snapshot.selection.activeId);
	const save = async (enabled, version) =>
		context.request.post(`${base}/api/admin/llm/save`, {
			headers: { origin: base },
			data: {
				id: active.id,
				expectedVersion: version,
				settings: { ...active, enabled },
				credential: { action: 'keep' }
			}
		});
	const disabled = await save(false, active.version);
	expect(disabled.status()).toBe(200);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Generate with AI', exact: true })).toBeDisabled();
	const titleInput = page.getByRole('textbox', { name: 'Title', exact: true });
	await titleInput.fill(`${title} ordinary edit`);
	await titleInput.blur();
	await expect.poll(async () => (await record()).config.title).toBe(`${title} ordinary edit`);
	expect((await save(true, (await disabled.json()).configuration.version)).status()).toBe(200);
	const anonymous = await browser.newContext();
	const anonymousResponse = await anonymous.request.get(`${base}/api/admin/llm`);
	expect(anonymousResponse.status()).toBe(401);
	expect(anonymousResponse.headers()['cache-control']).toBe('no-store');
	const email = `admin-${Date.now()}@fixture.test`,
		password = 'disposable-role-check-password';
	const account = await context.request.post(`${base}/api/admin/users`, {
		headers: { origin: base },
		data: { email, password, role: 'ADMIN' }
	});
	expect(account.status()).toBe(201);
	const user = (await account.json()).user;
	const other = await browser.newContext();
	const loginOther = () =>
		other.request.post(`${base}/login`, {
			headers: { origin: base },
			form: { email, password },
			maxRedirects: 0
		});
	await loginOther();
	expect((await other.request.get(`${base}/api/admin/llm`)).status()).toBe(200);
	expect(
		(
			await context.request.post(`${base}/api/admin/llm/save`, {
				headers: { origin: 'http://attacker.invalid' },
				data: {}
			})
		).status()
	).toBe(403);
	expect(
		(
			await context.request.patch(`${base}/api/admin/users/${user.id}`, {
				headers: { origin: base },
				data: { role: 'TEACHER' }
			})
		).status()
	).toBe(200);
	expect((await other.request.get(`${base}/api/admin/llm`)).status()).toBe(401);
	await loginOther();
	expect((await other.request.get(`${base}/api/admin/llm`)).status()).toBe(403);
	expect(
		(
			await other.request.post(`${base}/api/ai/activities`, {
				headers: { origin: base },
				data: {
					operationId: crypto.randomUUID(),
					creationId: id,
					activityType: 'word_cloud',
					topic: 'Colors',
					instructions: '',
					language: 'en',
					itemCount: 1
				}
			})
		).status()
	).toBe(404);
	console.log(
		'PASS ordinary title autosave while AI disabled; anonymous/teacher rejection, same-origin checks, revoked admin session, private creation isolation.'
	);
	await page.screenshot({ path: fileURLToPath(new URL('create.png', output)), fullPage: true });
	writeFileSync(
		new URL('results.json', output),
		JSON.stringify(
			{
				startedAt,
				completedAt: new Date().toISOString(),
				browserVersion: browser.version(),
				checks: [
					'10 API drafts; cancellation, removal and regeneration; 2 reviewed drafts persisted after Add',
					'ordinary autosave with AI disabled; account, origin, session and creation ownership checks'
				]
			},
			null,
			2
		)
	);
} finally {
	await browser.close();
}
