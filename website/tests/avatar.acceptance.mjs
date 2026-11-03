// Run only against the disposable auth.compose.yml fixture on loopback ports.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:9397';
const shots = new URL('../../test-results/avatars/', import.meta.url);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const failedRequests = [];

async function page(context, width) {
	const tab = await context.newPage();
	await tab.setViewportSize({ width, height: 850 });
	tab.on('pageerror', (error) => errors.push(error.message));
	tab.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	tab.on('requestfailed', (request) =>
		failedRequests.push({ url: request.url(), error: request.failure()?.errorText })
	);
	return tab;
}

async function enterRoom(tab, code) {
	await tab.goto(`${base}/en/play`);
	await tab.locator('#code').fill(code);
	await tab.getByRole('button', { name: 'Join', exact: true }).click();
	await tab.getByRole('button', { name: 'Change avatar' }).waitFor();
	assert.equal(await tab.getByRole('button', { name: 'Change avatar' }).innerText(), '');
}

async function checkLayout(tab, width) {
	await tab.setViewportSize({ width, height: 850 });
	assert(
		(await tab.evaluate(() => document.documentElement.scrollWidth)) <= width + 1,
		`overflow at ${width}`
	);
	await tab.getByRole('button', { name: 'Change avatar' }).click();
	const dialog = tab.getByRole('dialog');
	assert(await dialog.isVisible());
	assert.equal(await dialog.locator('.eye').count(), 0);
	assert.equal(await dialog.locator('.breath').count(), 0);
	assert.equal(await dialog.locator('.hair-layer').count(), 0);
	assert.equal(await dialog.getByRole('button', { name: /^Avatar \d+$/ }).count(), 20);
	assert.equal(await dialog.locator('.check').count(), 0);
	assert.equal(
		await dialog
			.locator('button[aria-pressed="true"]')
			.evaluate((button) => getComputedStyle(button).borderRadius),
		'50%'
	);
	const previousPortrait = await tab.locator('.avatar-preview .portrait').elementHandle();
	const bounds = await dialog.boundingBox();
	assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
	await dialog.locator('button[aria-pressed="true"]').focus();
	await tab.keyboard.press('Enter');
	await dialog.waitFor({ state: 'hidden' });
	assert.equal(await previousPortrait.evaluate((portrait) => portrait.isConnected), false);
	assert.equal(await tab.locator('.avatar-preview .wave-arm').count(), 1);
	assert.match(
		await tab
			.locator('.avatar-preview .wave-arm')
			.evaluate((arm) => getComputedStyle(arm).animationName),
		/wave$/
	);
	if (width === 1440) {
		const firstPose = await tab.locator('.avatar-preview .wave-arm').evaluate((arm) => {
			const animation = arm.getAnimations()[0];
			animation.pause();
			animation.currentTime = 150;
			return getComputedStyle(arm).transform;
		});
		const secondPose = await tab.locator('.avatar-preview .wave-arm').evaluate((arm) => {
			arm.getAnimations()[0].currentTime = 350;
			return getComputedStyle(arm).transform;
		});
		assert.notEqual(firstPose, secondPose);
		assert.equal(
			await tab
				.locator('.avatar-preview .wave-arm')
				.evaluate((arm) => getComputedStyle(arm).opacity),
			'1'
		);
		await tab.screenshot({ path: fileURLToPath(new URL('wave-1440.png', shots)) });
		await tab.locator('.avatar-preview .wave-arm').evaluate((arm) => arm.getAnimations()[0].play());
	}
	assert.equal(
		await tab.evaluate(() => document.activeElement?.getAttribute('aria-label')),
		'Change avatar'
	);
	await tab.getByRole('button', { name: 'Change avatar' }).click();
	await tab.waitForTimeout(200);
	await tab.screenshot({ path: fileURLToPath(new URL(`picker-${width}.png`, shots)) });
	await tab.keyboard.press('Escape');
	assert.equal(
		await tab.evaluate(() => document.activeElement?.getAttribute('aria-label')),
		'Change avatar'
	);
	await tab.waitForTimeout(200);
}

try {
	const hostContext = await browser.newContext();
	const login = await hostContext.request.post(`${base}/login`, {
		headers: { origin: base, accept: 'text/html' },
		form: { email: 'admin@acceptance.test', password: 'disposable-admin-password' },
		maxRedirects: 0
	});
	assert.equal(login.status(), 303);
	const response = await hostContext.request.post(`${base}/api/add`, {
		headers: { origin: base },
		data: {
			config: {
				title: 'Avatar acceptance',
				slides: [
					{
						MultipleChoice: {
							title: 'Choose yes',
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
	assert.equal(response.status(), 200);
	const room = await response.json();
	const host = await page(hostContext, 1440);
	await host.goto(`${base}/en/host/${room.game_id}`);
	await host.getByText(room.game_id, { exact: true }).waitFor();
	const rtlContext = await browser.newContext();
	const rtl = await page(rtlContext, 375);
	await rtl.goto(`${base}/ar/play?code=${room.game_id}`);
	await rtl.getByRole('button', { name: 'تغيير الصورة الرمزية' }).waitFor();
	assert.equal(await rtl.evaluate(() => document.documentElement.dir), 'rtl');
	assert((await rtl.evaluate(() => document.documentElement.scrollWidth)) <= 376);
	await rtl.getByRole('button', { name: 'تغيير الصورة الرمزية' }).click();
	assert.equal(await rtl.getByRole('button', { name: /^الصورة الرمزية \d+$/ }).count(), 20);
	await rtl.waitForTimeout(200);
	await rtl.screenshot({ path: fileURLToPath(new URL('picker-rtl-375.png', shots)) });
	await rtl.close();

	const context1 = await browser.newContext();
	const player1 = await page(context1, 1440);
	await enterRoom(player1, room.game_id);
	await player1.getByRole('button', { name: 'Change avatar' }).click();
	await player1.getByRole('button', { name: 'Avatar 8', exact: true }).click();
	assert.equal(await player1.locator('.avatar-preview .hair-layer').count(), 0);
	for (const number of [7, 16]) {
		await player1.getByRole('button', { name: 'Change avatar' }).click();
		await player1.getByRole('button', { name: `Avatar ${number}`, exact: true }).click();
		assert.equal(await player1.locator('.avatar-preview .eye').count(), 0);
		assert.equal(await player1.locator('.avatar-preview .breath').count(), 1);
		assert.equal(await player1.locator('.avatar-preview .hair-layer').count(), 1);
		await player1.waitForTimeout(950);
		for (const width of [1440, 768, 375]) {
			await player1.setViewportSize({ width, height: 850 });
			assert((await player1.evaluate(() => document.documentElement.scrollWidth)) <= width + 1);
			await player1.screenshot({
				path: fileURLToPath(new URL(`glasses-${number}-${width}.png`, shots))
			});
		}
		await player1.setViewportSize({ width: 1440, height: 850 });
	}
	await player1.getByRole('button', { name: 'Change avatar' }).click();
	await player1.getByRole('button', { name: 'Avatar 13', exact: true }).click();
	await player1.waitForTimeout(950);
	await player1.locator('.avatar-preview .hair-layer').evaluate((element) => {
		const animation = element.getAnimations()[0];
		animation.pause();
		animation.currentTime = 1200;
	});
	await player1.screenshot({ path: fileURLToPath(new URL('hair-afro-1440.png', shots)) });
	await player1.getByRole('button', { name: 'Change avatar' }).click();
	await player1.getByRole('button', { name: 'Avatar 13', exact: true }).click();
	assert.equal(await player1.locator('.avatar-preview .hair-layer').count(), 1);
	await player1.waitForTimeout(950);
	const original = await player1.locator('.avatar-preview img').getAttribute('src');
	assert.equal(original, '/avatars/avatar-13.png');
	assert.equal(await player1.locator('.avatar-preview .eye').count(), 2);
	const chest = player1.locator('.avatar-preview .breath');
	assert.equal(await chest.count(), 1);
	const rest = await chest.evaluate((element) => {
		const animation = element.getAnimations()[0];
		animation.pause();
		animation.currentTime = 0;
		return getComputedStyle(element).transform;
	});
	const inhale = await chest.evaluate((element) => {
		element.getAnimations()[0].currentTime = 1800;
		return getComputedStyle(element).transform;
	});
	assert.notEqual(rest, inhale);
	await player1.screenshot({ path: fileURLToPath(new URL('breathe-1440.png', shots)) });
	await chest.evaluate((element) => element.getAnimations()[0].play());
	const hair = player1.locator('.avatar-preview .hair-layer');
	assert.equal(await hair.count(), 1);
	const hairRest = await hair.evaluate((element) => {
		const animation = element.getAnimations()[0];
		animation.pause();
		animation.currentTime = 0;
		return getComputedStyle(element).transform;
	});
	await player1.screenshot({ path: fileURLToPath(new URL('hair-rest-1440.png', shots)) });
	const hairSway = await hair.evaluate((element) => {
		element.getAnimations()[0].currentTime = 1200;
		return getComputedStyle(element).transform;
	});
	assert.notEqual(hairRest, hairSway);
	await player1.screenshot({ path: fileURLToPath(new URL('hair-1440.png', shots)) });
	await hair.evaluate((element) => element.getAnimations()[0].play());
	assert.match(
		await player1
			.locator('.avatar-preview .eye')
			.first()
			.evaluate((eye) => getComputedStyle(eye).animationName),
		/blink$/
	);
	assert.equal(
		await player1
			.locator('.avatar-preview .eye')
			.first()
			.evaluate((eye) => getComputedStyle(eye).animationDuration),
		'3s'
	);
	await player1.locator('.avatar-preview .eye').evaluateAll((eyes) => {
		for (const eye of eyes) {
			const animation = eye.getAnimations()[0];
			animation.currentTime = 2850;
			animation.pause();
		}
	});
	assert.equal(
		await player1
			.locator('.avatar-preview .eye')
			.first()
			.evaluate((eye) => getComputedStyle(eye).opacity),
		'1'
	);
	await player1.screenshot({ path: fileURLToPath(new URL('blink-1440.png', shots)) });
	await player1.locator('.avatar-preview .eye').evaluateAll((eyes) => {
		for (const eye of eyes) eye.getAnimations()[0].play();
	});
	for (const width of [1440, 768, 375]) await checkLayout(player1, width);
	await player1.screenshot({ path: fileURLToPath(new URL('name-375.png', shots)) });
	await player1.emulateMedia({ reducedMotion: 'reduce' });
	assert.equal(
		await player1
			.locator('.avatar-preview .eye')
			.first()
			.evaluate((eye) => getComputedStyle(eye).animationName),
		'none'
	);
	assert.equal(await chest.evaluate((element) => getComputedStyle(element).animationName), 'none');
	assert.equal(await hair.evaluate((element) => getComputedStyle(element).animationName), 'none');
	await player1.getByRole('button', { name: 'Change avatar' }).click();
	await player1.getByRole('dialog').locator('button[aria-pressed="true"]').click();
	assert.match(
		await player1
			.locator('.avatar-preview .wave-arm')
			.evaluate((arm) => getComputedStyle(arm).animationName),
		/wave-still$/
	);
	await player1.getByRole('button', { name: 'Change avatar' }).click();
	assert(
		(await player1
			.getByRole('dialog')
			.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))) < 0.001
	);
	await player1.keyboard.press('Escape');
	await player1.emulateMedia({ reducedMotion: 'no-preference' });
	await player1.locator('#name').fill('AvatarOne');
	await player1.getByRole('button', { name: 'Ready' }).click();
	await host.getByRole('button', { name: /AvatarOne/ }).waitFor();
	assert.equal(
		await host
			.getByRole('button', { name: /AvatarOne/ })
			.locator('img')
			.getAttribute('src'),
		original
	);
	await host.screenshot({ path: fileURLToPath(new URL('waiting-host.png', shots)) });

	const context2 = await browser.newContext();
	const player2 = await page(context2, 375);
	await enterRoom(player2, room.game_id);
	const secondOriginal = await player2.locator('.avatar-preview img').getAttribute('src');
	await player2.locator('#name').fill('AvatarOne');
	await player2.getByRole('button', { name: 'Change avatar' }).click();
	await player2.getByRole('button', { name: 'Cancel' }).click();
	assert.equal(await player2.locator('.avatar-preview img').getAttribute('src'), secondOriginal);
	assert.equal(await player2.locator('#name').inputValue(), 'AvatarOne');
	await player2.getByRole('button', { name: 'Change avatar' }).click();
	await player2
		.getByRole('button', { name: `Avatar ${Number(original.match(/\d\d/)?.[0])}`, exact: true })
		.click();
	await player2.getByRole('dialog').waitFor({ state: 'hidden' });
	assert.equal(await player2.locator('.avatar-preview img').getAttribute('src'), original);
	await player2.getByRole('button', { name: 'Ready' }).click();
	await player2.getByText('Name taken').waitFor();
	assert.equal(await player2.locator('#name').inputValue(), 'AvatarOne');
	assert.equal(await player2.locator('.avatar-preview img').getAttribute('src'), original);
	await player2.getByRole('button', { name: 'Change avatar' }).click();
	await player2.getByRole('button', { name: 'Avatar 18', exact: true }).click();
	const secondSelected = '/avatars/avatar-18.png';
	assert.equal(await player2.locator('.avatar-preview img').getAttribute('src'), secondSelected);
	await player2.locator('#name').fill('AvatarTwo');
	await player2.getByRole('button', { name: 'Ready' }).click();
	await host.getByRole('button', { name: /AvatarTwo/ }).waitFor();
	assert.equal(
		await host
			.getByRole('button', { name: /AvatarTwo/ })
			.locator('img')
			.getAttribute('src'),
		secondSelected
	);
	await player2.reload();
	await player2.getByText('AvatarTwo', { exact: true }).waitFor();
	assert.equal(await player2.locator('.topbar img').getAttribute('src'), secondSelected);
	for (
		let step = 0;
		step < 5 && !(await player1.getByRole('button', { name: 'Yes' }).isVisible());
		step++
	) {
		await host.keyboard.press('PageDown');
		await host.waitForTimeout(400);
	}
	await player1.getByRole('button', { name: 'Yes' }).click();
	await player2.getByRole('button', { name: 'No' }).click();
	for (
		let step = 0;
		step < 6 && !(await host.locator('.entries .entry').first().isVisible());
		step++
	) {
		await host.keyboard.press('PageDown');
		await host.waitForTimeout(400);
	}
	const rows = host.locator('.entries .entry');
	await rows.filter({ hasText: 'AvatarOne' }).waitFor();
	await rows.filter({ hasText: 'AvatarTwo' }).waitFor();
	for (const [player, avatar] of [
		[player1, original],
		[player2, secondSelected]
	]) {
		await player.locator('.stack .portrait img').waitFor();
		assert.equal(await player.locator('.stack .portrait img').getAttribute('src'), avatar);
	}
	await player2.screenshot({ path: fileURLToPath(new URL('leaderboard-player2-375.png', shots)) });
	for (const width of [1440, 768, 375]) {
		await player1.setViewportSize({ width, height: 850 });
		assert((await player1.evaluate(() => document.documentElement.scrollWidth)) <= width + 1);
		await player1.screenshot({
			path: fileURLToPath(new URL(`leaderboard-player-${width}.png`, shots))
		});
	}
	assert.equal(
		await rows.filter({ hasText: 'AvatarOne' }).locator('img').getAttribute('src'),
		original
	);
	assert.equal(
		await rows.filter({ hasText: 'AvatarTwo' }).locator('img').getAttribute('src'),
		secondSelected
	);
	await host.waitForTimeout(4500);
	assert(await rows.filter({ hasText: 'AvatarOne' }).locator('img').isVisible());
	assert(await rows.filter({ hasText: 'AvatarTwo' }).locator('img').isVisible());
	await host.screenshot({ path: fileURLToPath(new URL('leaderboard-host.png', shots)) });
	console.log(JSON.stringify({ failedRequests, consoleErrors: errors }));
	assert.deepEqual(
		errors.filter((error) => !error.includes('ERR_NETWORK_ACCESS_DENIED')),
		[]
	);
	assert(
		!failedRequests.some(
			({ url, error }) =>
				(url.startsWith(base) || url.startsWith('http://127.0.0.1:9897')) &&
				error !== 'net::ERR_ABORTED'
		)
	);
	console.log(
		JSON.stringify({
			status: 'PASS',
			room: room.game_id,
			original,
			secondSelected,
			widths: [1440, 768, 375],
			checks: [
				'picker',
				'glasses-do-not-blink',
				'blink-breathe-hair-and-reduced-motion',
				'cancel',
				'duplicate-name',
				'same-avatar',
				'host-roster',
				'reconnect',
				'host-and-player-leaderboard',
				'rtl'
			]
		})
	);
} finally {
	await browser.close();
}
