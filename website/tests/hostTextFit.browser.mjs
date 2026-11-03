// Start tests/browser.vite.config.ts on port 9396 before running this check.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
	channel: 'chrome',
	headless: false
});

try {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('http://127.0.0.1:9396/tests/hostTextFit.browser.html');
	await page.locator('.text').waitFor();
	const sizes = new Map();
	for (const [width, height] of [
		[1440, 900],
		[768, 900],
		[375, 667]
	]) {
		await page.setViewportSize({ width, height });
		await page.waitForFunction(() => {
			const element = document.querySelector('.text');
			if (!element) return false;
			const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
			return element.scrollHeight <= lineHeight * 3 + 1;
		});
		const long = await page.locator('.text').evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				fontSize: Number.parseFloat(style.fontSize),
				lineHeight: Number.parseFloat(style.lineHeight),
				height: element.getBoundingClientRect().height,
				scrollHeight: element.scrollHeight,
				pageWidth: document.documentElement.scrollWidth
			};
		});
		assert.ok(long.height <= long.lineHeight * 3 + 1, `${width}: visible text exceeds three lines`);
		assert.ok(long.scrollHeight <= long.lineHeight * 3 + 1, `${width}: question was clipped`);
		assert.ok(long.pageWidth <= width, `${width}: horizontal overflow`);
		sizes.set(width, long.fontSize);
	}
	for (const [width, height] of [
		[1440, 900],
		[768, 900],
		[375, 667]
	]) {
		await page.setViewportSize({ width, height });
		await page.goto('http://127.0.0.1:9396/tests/hostTextFit.browser.html?short');
		await page.locator('.text').waitFor();
		const shortSize = await page
			.locator('.text')
			.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
		assert.ok(shortSize > sizes.get(width), `${width}: long text did not shrink`);
		console.log(`${width}px: long ${sizes.get(width)}px, short ${shortSize}px, 3 lines or fewer`);
	}
	// Height-only resizes must refit viewport-based font sizes and height limits.
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('http://127.0.0.1:9396/tests/hostTextFit.browser.html');
	await page.locator('.text').waitFor();
	await page.evaluate(() => document.fonts.ready);
	const fontSize = () =>
		page.locator('.text').evaluate((element) => getComputedStyle(element).fontSize);
	const tallSize = await fontSize();
	await page.setViewportSize({ width: 1440, height: 300 });
	await page.waitForFunction(
		() => {
			const element = document.querySelector('.text');
			return element && element.scrollHeight <= element.clientHeight + 1;
		},
		null,
		{ timeout: 5000 }
	);
	const resizedSize = await fontSize();
	await page.reload();
	await page.locator('.text').waitFor();
	await page.evaluate(() => document.fonts.ready);
	assert.equal(resizedSize, await fontSize(), 'height resize should match a fresh render');
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForFunction((expected) => {
		const element = document.querySelector('.text');
		return element && getComputedStyle(element).fontSize === expected;
	}, tallSize);
	console.log(`Height-only resize: ${tallSize} -> ${resizedSize} -> ${tallSize}, no clipping`);
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
}
