import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { getTranslations } from '../scripts/message-utils.js';

const base = 'http://127.0.0.1:9398'; // Disposable fixture only; never point this at application data.
const locales = JSON.parse(
	readFileSync(new URL('../project.inlang/settings.json', import.meta.url), 'utf8')
).locales;
const out = `test-results/llm/browser-${Date.now()}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
	headless: false,
	executablePath:
		process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const checks = [];
try {
	const login = await context.request.post(`${base}/login`, {
		form: { email: 'admin@llm.fixture', password: 'disposable-llm-admin-password' },
		headers: { origin: base, accept: 'text/html' },
		maxRedirects: 0
	});
	expect(login.status()).toBe(303);
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const consoleErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error')
			consoleErrors.push({ text: message.text(), url: message.location().url });
	});
	const api = async (action, body) =>
		context.request[action ? 'post' : 'get'](
			`${base}/api/admin/llm${action ? `/${action}` : ''}`,
			action ? { data: body, headers: { origin: base } } : {}
		);
	const list = async () => await (await api('')).json();
	await page.goto(`${base}/en/admin/llm`);
	await expect(page.getByRole('heading', { name: 'LLM configuration', exact: true })).toBeVisible();
	const field = (name) => page.getByLabel(name, { exact: true }).and(page.locator('input'));
	const button = (name) => page.getByRole('main').getByRole('button', { name, exact: true });
	const keyTrigger = page.locator('button[popovertarget="llm-credential-options"]');
	const replaceKey = async () => {
		await keyTrigger.click();
		await page.getByRole('option', { name: 'Replace key', exact: true }).click();
		await expect(keyTrigger).toBeFocused();
	};
	const name = `Browser ${Date.now()}`;
	await field('Configuration name').fill(name);
	await field('API base URL').fill('http://127.0.0.1:11434/v1');
	await expect(button('Discover models')).toHaveCount(0);
	await expect(field('Model ID')).toHaveValue('');
	await field('Model ID').fill('fixture-model');
	await field('Enabled').check();
	await replaceKey();
	await field('Replace key').fill('fixture-local-key');
	await field('Items per batch').fill('9');
	await field('Maximum concurrent operations').fill('5');
	const beforeReset = (await list()).configurations.length;
	await button('Reset to defaults').click();
	await expect(field('Items per batch')).toHaveValue('3');
	await expect(field('Maximum concurrent operations')).toHaveValue('2');
	await expect(field('Configuration name')).toHaveValue(name);
	await expect(field('Enabled')).toBeChecked();
	await expect(field('Replace key')).toHaveValue('fixture-local-key');
	expect((await list()).configurations.length).toBe(beforeReset);
	await button('Save changes').click();
	await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
	const saved = (await list()).configurations.find((c) => c.name === name);
	expect(saved.hasApiKey).toBe(true);
	expect(saved.maxConcurrentOperations).toBe(2);
	expect(JSON.stringify(saved)).not.toContain('fixture-local-key');
	expect((await list()).selection.activeId).not.toBe(saved.id);
	await button('Test connection').click();
	await expect(
		page.getByText('This form configuration passed the connection test.', { exact: true })
	).toBeVisible();
	await field('Temperature').fill('0.7');
	await expect(page.getByText('Untested configuration', { exact: true })).toBeVisible();
	await replaceKey();
	await field('Replace key').fill('discard-this-secret');
	await button('Discard edits').click();
	await expect(field('Temperature')).toHaveValue('0.5');
	await expect(keyTrigger).toHaveText('Keep existing key');
	expect(await page.locator('input[type=password]').count()).toBe(0);
	checks.push(
		'Reset preserves identity, endpoint, model, enabled and pending key; discard restores saved fields and clears pending secrets; save/test never activate.'
	);
	let release;
	const gate = new Promise((r) => {
		release = r;
	});
	let arrived;
	const arrival = new Promise((r) => {
		arrived = r;
	});
	await page.route('**/api/admin/llm/test', async (route) => {
		const response = await route.fetch();
		arrived();
		await gate;
		await route.fulfill({ response });
	});
	await button('Test connection').click();
	await arrival;
	await field('Temperature').fill('0.6');
	release();
	await expect(button('Test connection')).toBeEnabled();
	await expect(page.getByText('Untested configuration', { exact: true })).toBeVisible();
	await page.unroute('**/api/admin/llm/test');
	await button('Discard edits').click();
	await button('Activate').click();
	await expect(page.locator('.status')).toHaveText(`Active: ${name}`);
	const storedBefore = (await list()).configurations.find((c) => c.id === saved.id);
	expect(
		(
			await api('save', {
				id: saved.id,
				expectedVersion: storedBefore.version,
				settings: { ...storedBefore, name: `${name} remote` },
				credential: { action: 'keep' }
			})
		).status()
	).toBe(200);
	await field('Temperature').fill('0.7');
	await button('Save changes').click();
	await expect(page.getByRole('alert')).toContainText('Newer settings exist');
	await expect(field('Temperature')).toHaveValue('0.7');
	await button('Reload saved settings').click();
	await expect(field('Temperature')).toHaveValue('0.5');
	await field('Enabled').uncheck();
	await button('Save changes').click();
	await expect(page.locator('.status')).toHaveText('No usable active configuration.');
	expect((await list()).selection.activeId).toBe(saved.id);
	await field('Enabled').check();
	await button('Save changes').click();
	await expect(page.locator('.status')).toContainText('Active:');
	checks.push(
		'Stale tests ignored; conflicting edits return 409 and preserve form; disabling selected configuration keeps selection without fallback.'
	);
	for (const [locale, width, height] of [
		['en', 1440, 1000],
		['en', 768, 1024],
		['en', 375, 812],
		['th', 375, 812],
		['ar', 375, 812]
	].filter(([locale]) => locales.includes(locale))) {
		await page.setViewportSize({ width, height });
		await page.goto(`${base}/${locale}/admin/llm`);
		await page
			.locator('.configuration')
			.filter({ hasText: `${name} remote` })
			.click();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		const first = page.locator('form input').first();
		await first.focus();
		await page.keyboard.press('Tab');
		expect(
			await page.evaluate(() => {
				const e = document.activeElement;
				return e?.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none';
			})
		).toBe(true);
		const messages = getTranslations(locale);
		expect(await page.locator('html').getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
		for (const [id, label, labels] of [
			[
				'llm-provider-options',
				messages.llm_provider,
				['Ollama', 'vLLM', 'OpenAI', 'Gemini', 'Claude', 'OpenAI-compatible']
			],
			[
				'llm-credential-options',
				messages.llm_api_key,
				[messages.llm_key_keep, messages.llm_key_replace, messages.llm_key_remove]
			]
		]) {
			const trigger = page.locator(`button[popovertarget="${id}"]`);
			const listbox = page.getByRole('listbox', { name: label, exact: true });
			await trigger.focus();
			await trigger.press('Enter');
			await expect(trigger).toHaveAttribute('aria-expanded', 'true');
			const options = listbox.getByRole('option');
			await expect(options).toHaveText(labels);
			await expect(options.first()).toBeFocused();
			await expect(options.first()).toHaveAttribute('aria-selected', 'true');
			expect(
				await listbox.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return (
						rect.left >= 0 &&
						rect.top >= 0 &&
						rect.right <= innerWidth &&
						rect.bottom <= innerHeight &&
						element.scrollWidth <= element.clientWidth
					);
				})
			).toBe(true);
			if (id === 'llm-provider-options') {
				await expect(listbox.locator('img')).toHaveCount(6);
				await expect
					.poll(() =>
						listbox
							.locator('img')
							.evaluateAll((images) =>
								images.every((image) => image.complete && image.naturalWidth > 0)
							)
					)
					.toBe(true);
			}
			await page.screenshot({ path: `${out}/${locale}-${width}-${id}.png` });
			await page.keyboard.press('ArrowDown');
			await expect(options.nth(1)).toBeFocused();
			await page.keyboard.press('ArrowUp');
			await expect(options.first()).toBeFocused();
			await page.keyboard.press('End');
			await expect(options.last()).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(listbox).toBeHidden();
			await expect(trigger).toBeFocused();
			await expect(trigger).toHaveText(labels.at(-1));
			await trigger.press('Space');
			await expect(options.last()).toBeFocused();
			await page.keyboard.press('Home');
			await expect(options.first()).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(trigger).toHaveText(labels[0]);
			await trigger.click();
			await options.nth(1).click();
			await expect(trigger).toHaveText(labels[1]);
			await trigger.click();
			await options.first().click();
			await trigger.press('Enter');
			await expect(options.first()).toBeFocused();
			await page.keyboard.press('ArrowDown');
			await page.keyboard.press('Escape');
			await expect(trigger).toBeFocused();
			await expect(listbox).toBeHidden();
			await expect(trigger).toHaveAttribute('aria-expanded', 'false');
			await expect(trigger).toHaveText(labels[0]);
			await trigger.click();
			await expect(listbox).toBeVisible();
			await page.locator('main h1').click();
			await expect(listbox).toBeHidden();
		}
		writeFileSync(
			`${out}/${locale}-${width}-bounds.json`,
			JSON.stringify(
				await page.locator('main').evaluate((e) => ({
					main: e.getBoundingClientRect().toJSON(),
					children: [...e.querySelectorAll('header,.editor,.configuration,h1,p')].map((n) => ({
						tag: n.tagName,
						text: n.textContent.slice(0, 35),
						rect: n.getBoundingClientRect().toJSON()
					}))
				})),
				null,
				2
			)
		);
		await page.screenshot({ path: `${out}/${locale}-${width}.png`, fullPage: true });
	}
	checks.push(
		'Rendered en 1440/768/375 and additional configured mobile locales: no page/popover overflow; six provider logos loaded; both dropdowns support pointer selection, Enter/Space, arrows, Home/End, Escape, outside dismissal and focus return.'
	);
	const deletionName = `Delete fixture ${Date.now()}`;
	const createForDeletion = async (configurationName) => {
		const response = await api('save', {
			id: null,
			expectedVersion: null,
			settings: {
				...(await list()).configurations.find((c) => c.id === saved.id),
				name: configurationName
			},
			credential: { action: 'replace', value: 'synthetic-deletion-key' }
		});
		expect(response.status()).toBe(200);
		return (await response.json()).configuration;
	};
	const deleting = await createForDeletion(deletionName);
	for (const [locale, width, height] of [
		['en', 1440, 1000],
		['en', 768, 1024],
		['en', 375, 812],
		['th', 375, 812],
		['ar', 375, 812]
	].filter(([locale]) => locales.includes(locale))) {
		await page.setViewportSize({ width, height });
		await page.goto(`${base}/${locale}/admin/llm`);
		await page.locator('.configuration').filter({ hasText: deletionName }).click();
		const messages = getTranslations(locale);
		const remove = button(messages.llm_delete);
		await remove.focus();
		await remove.press('Enter');
		const dialog = page.getByRole('dialog', { name: messages.llm_delete, exact: true });
		await expect(dialog).toBeVisible();
		await expect
			.poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity))
			.toBe('1');
		await expect(dialog).toContainText(deletionName);
		await expect(dialog).not.toContainText(messages.llm_delete_active_warning);
		expect(
			await dialog.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return (
					rect.left >= 0 &&
					rect.top >= 0 &&
					rect.right <= innerWidth &&
					rect.bottom <= innerHeight &&
					element.scrollWidth <= element.clientWidth
				);
			})
		).toBe(true);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({
			path: `${out}/${locale}-${width}-delete-dialog.png`,
			animations: 'disabled'
		});
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(remove).toBeFocused();
		expect((await list()).configurations.some((c) => c.id === deleting.id)).toBe(true);
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto(`${base}/en/admin/llm`);
	await page.locator('.configuration').filter({ hasText: deletionName }).click();
	await field('Temperature').fill('0.6');
	await expect(button('Delete configuration')).toBeDisabled();
	await button('Discard edits').click();
	await button('Delete configuration').click();
	let dialog = page.getByRole('dialog', { name: 'Delete configuration', exact: true });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	const changedBeforeDelete = await api('save', {
		id: deleting.id,
		expectedVersion: deleting.version,
		settings: deleting,
		credential: { action: 'keep' }
	});
	expect(changedBeforeDelete.status()).toBe(200);
	await button('Delete configuration').click();
	await dialog.getByRole('button', { name: 'Delete configuration', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText(getTranslations('en').llm_conflict);
	await expect(field('Configuration name')).toHaveValue(deletionName);
	expect((await list()).configurations.some((c) => c.id === deleting.id)).toBe(true);
	await button('Reload saved settings').click();
	const activeBeforeDelete = (await list()).selection.activeId;
	await button('Delete configuration').click();
	await dialog.getByRole('button', { name: 'Delete configuration', exact: true }).click();
	await expect(page.getByText('Configuration deleted.', { exact: true })).toBeVisible();
	expect((await list()).configurations.some((c) => c.id === deleting.id)).toBe(false);
	expect((await list()).selection.activeId).toBe(activeBeforeDelete);
	const history = await api('audit', { id: deleting.id });
	expect((await history.json()).audit.filter((entry) => entry.action === 'delete')).toHaveLength(1);
	const activeDeletion = await createForDeletion(`${deletionName} active`);
	expect(
		(
			await api('select', {
				id: activeDeletion.id,
				expectedConfigurationVersion: activeDeletion.version,
				expectedSelectionVersion: (await list()).selection.version
			})
		).status()
	).toBe(200);
	await page.goto(`${base}/en/admin/llm`);
	await page.locator('.configuration').filter({ hasText: activeDeletion.name }).click();
	await button('Delete configuration').click();
	dialog = page.getByRole('dialog', { name: 'Delete configuration', exact: true });
	await expect(dialog).toContainText(getTranslations('en').llm_delete_active_warning);
	await dialog.getByRole('button', { name: 'Delete configuration', exact: true }).click();
	await expect(page.locator('.status')).toHaveText('No usable active configuration.');
	await expect(page.getByText('Configuration deleted.', { exact: true })).toBeVisible();
	expect((await list()).selection.activeId).toBeNull();
	expect((await list()).established).toBe(true);
	await page.screenshot({ path: `${out}/delete-success.png`, fullPage: true });
	checks.push(
		'Deletion: desktop/tablet/mobile and additional configured mobile locales, confirmation bounds, keyboard cancel/focus return, dirty-form protection, stale-write 409, retained history, inactive selection preserved and active selection cleared without fallback.'
	);
	await page.goto(`${base}/en/admin/users`);
	await expect(page.getByRole('link', { name: 'LLM configuration', exact: true })).toHaveCount(0);
	await page.goto(`${base}/en/`);
	await expect(page.getByRole('link', { name: 'LLM configuration', exact: true })).toBeVisible();
	expect(errors).toEqual([]);
	// Preserve external font failures as separate evidence; all other console errors still fail.
	const externalFontErrors = consoleErrors.filter(
		(entry) =>
			entry.url.startsWith('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai+Looped:') &&
			[
				'Failed to load resource: net::ERR_CONNECTION_CLOSED',
				'Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED'
			].includes(entry.text)
	);
	const applicationConsoleErrors = consoleErrors.filter(
		(entry) => !externalFontErrors.includes(entry)
	);
	// The stale-save and stale-delete scenarios deliberately produce HTTP 409 entries.
	expect(applicationConsoleErrors).toEqual([
		{ text: expect.stringContaining('409'), url: `${base}/api/admin/llm/save` },
		{ text: expect.stringContaining('409'), url: `${base}/api/admin/llm/delete` }
	]);
	writeFileSync(
		`${out}/results.json`,
		JSON.stringify(
			{ checks, configuredLocales: locales, pageErrors: errors, consoleErrors, externalFontErrors },
			null,
			2
		)
	);
	console.log('PASS', checks.join('\n'));
	console.log(`Evidence: ${out}`);
	if (externalFontErrors.length)
		console.log(
			`WARNING ${externalFontErrors.length} external Google Fonts network failures recorded; fallback font rendered.`
		);
} finally {
	await browser.close();
}
