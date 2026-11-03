// Isolated component tests; run using tests/browser.vite.config.ts.
import { mount, tick, unmount } from 'svelte';
import '@fontsource/poppins/800.css';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/noto-sans';
import { MAX_ACTIVITY_ITEMS } from '../src/lib/ai/activityGeneration';
import * as m from '../src/lib/paraglide/messages.js';
import { overwriteGetLocale } from '../src/lib/paraglide/runtime.js';
import type { Database } from '../src/lib/storage';
import type { Base64Media, GenericFuizConfig } from '../src/lib/types';
import layout from '../src/routes/+layout.svelte?raw';
import AiActivityDialog from '../src/routes/[[lang=locale]]/create/AiActivityDialog.svelte';
import { appendActivityDrafts } from '../src/routes/[[lang=locale]]/create/aiActivitySlides';

const locale = new URL(location.href).searchParams.get('lang') === 'th' ? 'th' : 'en';
document.documentElement.lang = locale;
overwriteGetLocale(() => locale);
const style = document.createElement('style');
style.textContent = (layout.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(
	/:global\(([^)]+)\)/g,
	'$1'
);
document.head.append(style);
const target = document.querySelector<HTMLElement>('#test');
const output = document.querySelector<HTMLOutputElement>('#result');
if (!target || !output) throw new Error('Missing test containers');
let checks = 0;
function assert(value: unknown, message: string) {
	if (!value) throw new Error(message);
	checks++;
}
const settle = async () => {
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 0));
};
const until = async (test: () => boolean) => {
	for (let i = 0; i < 100; i++) {
		if (test()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('Timed out waiting for component');
};
const identity = {
	user: {
		id: '11111111-1111-4111-8111-111111111111',
		email: 'fixture@example.test',
		role: 'TEACHER'
	},
	sessionIssuedAt: 1
};
const db = { ...identity, closed: false, close() {} } as Database;
let calls = 0;
let cancelled = 0;
let release: (() => void) | undefined;
let hold = false;
window.fetch = (async (input, init) => {
	if (String(input) === '/api/account') return Response.json(identity);
	if (String(input).endsWith('/cancel')) {
		cancelled++;
		return Response.json({});
	}
	assert(String(input) === '/api/ai/activities', 'Only AI and account endpoints used');
	const body = JSON.parse(String(init?.body));
	assert(
		!('media' in body) && !JSON.stringify(body).includes('data:image'),
		'Images never enter AI requests'
	);
	calls++;
	if (hold)
		await new Promise<void>((resolve) => {
			release = resolve;
		});
	return Response.json({
		operationId: body.operationId,
		resolvedLanguage: 'en',
		drafts: Array.from({ length: body.itemCount }, (_, i) =>
			body.activityType === 'pin_answer'
				? { question: `Locate ${i}`, difficulty: 'medium' }
				: body.activityType === 'drop_pin'
					? { question: `Mark ${i}` }
					: body.activityType === 'ordering'
						? { question: `Order ${i}`, items: ['First', 'Second', 'Third'], difficulty: 'medium' }
						: { prompt: `Prompt ${i}` }
		)
	});
}) as typeof fetch;
let config: GenericFuizConfig<Base64Media | undefined> = { title: 'Unchanged title', slides: [] };
const component = mount(AiActivityDialog, {
	target,
	props: {
		db,
		creationId: crypto.randomUUID(),
		remainingSlides: 500,
		onadd: (request, drafts, labels, attachments) => {
			config = appendActivityDrafts(config, request, drafts, labels, attachments);
		}
	}
});
const element = <T extends Element>(selector: string): T => {
	const found = target.querySelector<T>(selector);
	if (!found) throw new Error(`Missing ${selector}`);
	return found;
};
const button = (name: string, root: Element = target) => {
	const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
		(candidate) =>
			candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name
	);
	if (!found) throw new Error(`Missing button ${name}`);
	return found;
};
const fill = async (input: HTMLInputElement, value: string) => {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await settle();
};
const select = async (type: string, count = 2) => {
	element<HTMLButtonElement>('[popovertarget="ai-activity-type"]').click();
	await settle();
	element<HTMLButtonElement>(`#ai-activity-type [role=option][value="${type}"]`).click();
	await fill(element('#ai-topic'), 'Synthetic classroom');
	await fill(element('input[type=number]'), String(count));
};
const generate = async () => {
	element<HTMLFormElement>('form').dispatchEvent(
		new Event('submit', { bubbles: true, cancelable: true })
	);
	await until(() => !!target.querySelector('.drafts fieldset'));
	await settle();
};
const canvas = document.createElement('canvas');
canvas.width = 100;
canvas.height = 60;
const context = canvas.getContext('2d');
if (!context) throw new Error('No canvas');
const upload = async (root: Element, color: string) => {
	context.fillStyle = color;
	context.fillRect(0, 0, 100, 60);
	const blob = await new Promise<Blob>((resolve) =>
		canvas.toBlob((value) => {
			if (value) resolve(value);
		})
	);
	const transfer = new DataTransfer();
	transfer.items.add(new File([blob], `${color}.png`, { type: 'image/png' }));
	const input = root.querySelector<HTMLInputElement>('input[type=file]');
	if (!input) throw new Error('No scoped file input');
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await until(() => !!root.querySelector('.image-card img'));
	await settle();
};

if (new URL(location.href).searchParams.has('preview')) {
	await settle();
	component.open();
} else
	try {
		await settle();
		component.open();
		await settle();
		const count = element<HTMLInputElement>('input[type=number]');
		assert(
			count.value === '5' && count.max === String(MAX_ACTIVITY_ITEMS),
			'Default 5; max from shared constant'
		);
		const hintId = count.getAttribute('aria-describedby')?.split(' ')[0];
		assert(
			hintId &&
				document.getElementById(hintId)?.textContent ===
					m.ai_item_count_max({ count: MAX_ACTIVITY_ITEMS }),
			'Count hint visible and described before interaction'
		);
		assert(!target.querySelector('select'), 'Every dialog dropdown uses the styled picker');
		const typeTrigger = element<HTMLButtonElement>('[popovertarget="ai-activity-type"]');
		typeTrigger.click();
		await settle();
		assert(
			element('#ai-activity-type').querySelectorAll('[role=option] svg').length === 13,
			'All 13 types have icons'
		);
		assert(typeTrigger.getAttribute('aria-expanded') === 'true', 'Expanded state announced');
		const selected = element<HTMLButtonElement>('#ai-activity-type [aria-selected=true]');
		assert(document.activeElement === selected, 'Opening focuses the selected option');
		selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		assert(
			document.activeElement === element('#ai-activity-type [value=brainstorm]'),
			'End focuses the final type'
		);
		document.activeElement?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		await settle();
		assert(
			document.activeElement === typeTrigger && element<HTMLDialogElement>('dialog').open,
			'Escape returns focus without closing the dialog'
		);
		for (const [id, value] of [
			['ai-language', 'th'],
			['ai-choice-count', '2']
		]) {
			const trigger = element<HTMLButtonElement>(`[popovertarget="${id}"]`);
			trigger.click();
			await settle();
			element<HTMLButtonElement>(`#${id} [value="${value}"]`).click();
			await settle();
			assert(
				document.activeElement === trigger && trigger.getAttribute('aria-expanded') === 'false',
				`${id} selects and returns focus`
			);
		}
		await select('word_cloud');
		for (const invalid of ['11', '30', '0', '-1', '1.5', '']) {
			await fill(count, invalid);
			const before = calls;
			element<HTMLFormElement>('form').dispatchEvent(
				new Event('submit', { bubbles: true, cancelable: true })
			);
			await settle();
			assert(
				calls === before && count.getAttribute('aria-invalid') === 'true',
				`Invalid count ${invalid} cannot submit`
			);
			assert(!!target.querySelector('[role=alert]'), 'Invalid count announced');
		}
		await select('ordering');
		await generate();
		assert(
			typeTrigger.disabled && element<HTMLButtonElement>('[popovertarget="ai-language"]').disabled,
			'Dropdowns lock while reviewing drafts'
		);
		assert(config.slides.length === 0, 'Generation does not persist drafts');
		const ordered = element<HTMLElement>('.drafts fieldset');
		button(m.move_down(), ordered).click();
		await settle();
		assert(
			ordered.querySelectorAll<HTMLInputElement>('.answer-row input')[0].value === 'Second',
			'Ordering move down changes correct order'
		);
		const up = [...ordered.querySelectorAll<HTMLButtonElement>('button')].find(
			(candidate) => candidate.getAttribute('aria-label') === m.move_up() && !candidate.disabled
		);
		if (!up) throw new Error('Missing enabled move up');
		up.click();
		await settle();
		assert(
			ordered.querySelectorAll<HTMLInputElement>('.answer-row input')[0].value === 'First',
			'Ordering move up restores order'
		);
		button(m.cancel()).click();
		await settle();
		component.open();
		await settle();
		await select('pin_answer');
		await generate();
		let fields = [...target.querySelectorAll<HTMLElement>('.drafts > fieldset')];
		const inputIds = fields.map((field) => field.querySelector('input[type=file]')?.id);
		assert(
			new Set(inputIds).size === 2 && inputIds.every(Boolean),
			'Each image input has its own ID'
		);
		assert(
			button(m.ai_add_to_activity()).disabled,
			'Pin drafts blocked without images and targets'
		);
		await upload(fields[1], 'blue');
		assert(!fields[0].querySelector('img'), 'Second upload stays on second draft');
		const blue = fields[1].querySelector<HTMLImageElement>('.image-card img')?.src;
		await upload(fields[0], 'red');
		assert(
			fields[0].querySelector<HTMLImageElement>('.image-card img')?.src !== blue,
			'Images remain distinct'
		);
		button(m.remove(), element('.drafts > fieldset .remove-action')).click();
		await settle();
		fields = [...target.querySelectorAll<HTMLElement>('.drafts > fieldset')];
		assert(
			fields.length === 1 &&
				fields[0].querySelector<HTMLImageElement>('.image-card img')?.src === blue,
			'Deleting first draft preserves second image'
		);
		for (const [name, value] of [
			['x', '20'],
			['y', '30'],
			['width', '40'],
			['height', '50']
		]) {
			await fill(element<HTMLInputElement>(`[data-target-field=${name}]`), value);
		}
		assert(!button(m.ai_add_to_activity()).disabled, 'Keyboard fields create a valid target');
		button(m.remove(), element('.image-card')).click();
		await settle();
		await upload(fields[0], 'green');
		assert(button(m.ai_add_to_activity()).disabled, 'Replacing image clears the target');
		for (const [name, value] of [
			['x', '10'],
			['y', '10'],
			['width', '30'],
			['height', '40']
		]) {
			await fill(element<HTMLInputElement>(`[data-target-field=${name}]`), value);
		}
		button(m.ai_add_to_activity()).click();
		await settle();
		assert(
			config.title === 'Unchanged title' && config.slides.length === 1,
			'Explicit Add preserves title'
		);
		const pin = config.slides[0];
		assert(
			'Pin' in pin &&
				pin.Pin.correct_area &&
				'Rectangle' in pin.Pin.correct_area &&
				pin.Pin.correct_area.Rectangle.width === 0.3,
			'Teacher target converts to normalized coordinates'
		);
		component.open();
		await settle();
		await select('word_cloud');
		hold = true;
		element<HTMLFormElement>('form').dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true })
		);
		await until(() => !!release);
		assert(typeTrigger.disabled, 'Dropdown locks during generation');
		button(m.cancel()).click();
		await settle();
		release?.();
		await settle();
		assert(
			cancelled === 1 && !target.querySelector('.drafts fieldset'),
			'Cancellation ignores late drafts'
		);
		await unmount(component);
		const limited = mount(AiActivityDialog, {
			target,
			props: { db, creationId: crypto.randomUUID(), remainingSlides: 1, onadd() {} }
		});
		await settle();
		limited.open();
		await settle();
		assert(
			element<HTMLInputElement>('input[type=number]').max === '1',
			'Remaining capacity bounds input'
		);
		await select('word_cloud', 2);
		const before = calls;
		element<HTMLFormElement>('form').dispatchEvent(
			new Event('submit', { bubbles: true, cancelable: true })
		);
		await settle();
		assert(calls === before, 'Remaining capacity blocks submission');
		await unmount(limited);
		output.textContent = `PASS ${checks} AI dialog checks (${m.ai_item_count()})`;
	} catch (error) {
		output.textContent = `FAIL after ${checks} checks: ${error instanceof Error ? error.message : String(error)}`;
		console.error(output.textContent);
	}
