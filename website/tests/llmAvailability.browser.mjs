import { chromium, expect } from '@playwright/test';

const base = 'http://127.0.0.1:9398'; // Synthetic disposable fixture only.
const browser = await chromium.launch({
	headless: false,
	executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
try {
	const context = await browser.newContext();
	await context.request.post(`${base}/login`, {
		form: { email: 'admin@llm.fixture', password: 'disposable-llm-admin-password' },
		headers: { origin: base, accept: 'text/html' },
		maxRedirects: 0
	});
	const api = async (action, data) => {
		const response = await context.request.post(`${base}/api/admin/llm/${action}`, {
			data,
			headers: { origin: base }
		});
		expect(response.status()).toBe(200);
		return response.json();
	};
	const list = async () => (await context.request.get(`${base}/api/admin/llm`)).json();
	const { configuration } = await api('save', {
		id: null,
		expectedVersion: null,
		credential: { action: 'remove' },
		settings: {
			name: 'Navigation availability',
			provider: 'custom',
			endpoint: 'http://127.0.0.1:11434/v1',
			model: 'fixture',
			enabled: true,
			temperature: 0.5,
			topP: 0.95,
			maxOutputTokens: 4096,
			requestTimeoutSeconds: 240,
			generationTimeoutSeconds: 900,
			batchSize: 3
		}
	});
	const select = async (id) =>
		api('select', {
			id,
			expectedConfigurationVersion: id ? configuration.version : null,
			expectedSelectionVersion: (await list()).selection.version
		});
	await select(null);
	const page = await context.newPage();
	for (const enabled of [true, false]) {
		await page.goto(`${base}/en/`);
		await expect(page.locator('header').getByRole('link', { name: /Create Quiz/ })).toBeVisible();
		await page.evaluate(() => {
			window.navigationMarker = 'same-document';
		});
		// Simulates activation in another tab after this tab loaded its shared layout.
		await select(enabled ? configuration.id : null);
		await page
			.locator('header')
			.getByRole('link', { name: /Create Quiz/ })
			.click();
		await page.getByRole('button', { name: 'Create New', exact: true }).first().click();
		const generate = page.getByRole('button', { name: 'Generate with AI', exact: true });
		await expect(generate).toBeVisible();
		await expect(generate).toBeEnabled({ enabled });
		expect(await page.evaluate(() => window.navigationMarker)).toBe('same-document');
	}
	console.log(
		'PASS: editor refreshes AI availability on client navigation after activation and deactivation.'
	);
} finally {
	await browser.close();
}
