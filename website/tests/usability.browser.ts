import { mount, tick, unmount } from 'svelte';
import { overwriteGetLocale } from '../src/lib/paraglide/runtime';
import { addCreation, clearAccountStorage, loadDatabase } from '../src/lib/storage';
import Gallery from '../src/routes/[[lang=locale]]/create/Gallery.svelte';
import Reports from '../src/routes/[[lang=locale]]/reports/+page.svelte';
import Editor from './BrowserEditor.svelte';

const checks: string[] = [];
const target = document.querySelector('#test-root') as HTMLElement;
const pause = () => new Promise((done) => setTimeout(done, 50));
async function until(test: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (test()) return;
		await pause();
	}
	throw new Error('Timed out waiting for UI: ' + target.textContent);
}
function check(value: unknown, name: string) {
	if (!value) throw new Error(name);
	checks.push(name);
}
function button(text: string) {
	const found = [...target.querySelectorAll('button')].find(
		(el) => el.textContent?.trim() === text
	);
	if (!found) throw new Error('Missing button: ' + text);
	return found;
}
async function input(selector: string, value: string) {
	const el = target.querySelector<HTMLInputElement>(selector);
	if (!el) throw new Error('Missing input: ' + selector);
	el.focus();
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	return el;
}
async function run() {
	overwriteGetLocale(() => 'en');
	const actor = crypto.randomUUID();
	const records = new Map<string, any>();
	let failReports = true;
	let reportLoads = 0;
	window.fetch = (async (url: string, init?: RequestInit) => {
		if (url === '/api/account')
			return Response.json({ user: { id: actor, role: 'TEACHER' }, sessionIssuedAt: 1 });
		if (url === '/api/gdrive/status')
			return Response.json({ available: false, authenticated: false });
		if (url === '/api/reports') {
			reportLoads++;
			await pause();
			return failReports
				? Response.json({}, { status: 503 })
				: Response.json({
						resources: [
							{
								record: {
									uniqueId: crypto.randomUUID(),
									versionId: 0,
									lastEdited: 1,
									playedAt: new Date(2026, 8, 19, 23, 59).getTime(),
									title: 'Thai ภาษาไทย report',
									playerCount: 0,
									questions: [],
									results: []
								}
							}
						]
					});
		}
		if (init?.method === 'POST' || init?.method === 'PUT') {
			const body = JSON.parse(String(init.body));
			const record = body.record ?? body;
			records.set(record.uniqueId, record);
			return Response.json({ record });
		}
		return Response.json({ record: records.get(url.split('/')[3]) });
	}) as typeof fetch;
	let app = mount(Reports, { target });
	await until(() => !!target.querySelector('[role="alert"]'));
	check(
		target.textContent?.includes('Could not load reports'),
		'report load uses a load-specific error'
	);
	await input('input[type="search"]', 'ภาษาไทย');
	failReports = false;
	button('Retry').click();
	button('Retry').click();
	await until(() => !!target.querySelector('.card'));
	check(
		reportLoads === 2 && target.querySelectorAll('.card').length === 1,
		'retry prevents duplicate loads and replaces records'
	);
	check(
		(target.querySelector('input[type="search"]') as HTMLInputElement).value === 'ภาษาไทย',
		'retry preserves filters'
	);
	check(document.activeElement?.tagName === 'H2', 'retry restores focus to reports heading');
	const dateInput = await input('fieldset input[type="text"]', '31/01/2024');
	const picker = target.querySelector<HTMLButtonElement>('.date-field .trigger');
	const calendar = target.querySelector<HTMLDivElement>('.calendar');
	if (!picker || !calendar) throw new Error('Missing date picker');
	picker.click();
	await until(
		() =>
			calendar.matches(':popover-open') &&
			document.activeElement?.classList.contains('day') === true
	);
	check(
		document.activeElement?.getAttribute('aria-selected') === 'true',
		'calendar opens on the typed date'
	);
	check(
		calendar.querySelectorAll('.day').length === 35,
		'five-week month omits the extra calendar row'
	);
	document.activeElement?.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })
	);
	await tick();
	await tick();
	check(
		document.activeElement?.textContent === '29',
		'month navigation clamps January 31 to leap day'
	);
	(document.activeElement as HTMLButtonElement).click();
	await tick();
	check(
		dateInput.value === '29/02/2024' &&
			document.activeElement === picker &&
			!calendar.matches(':popover-open'),
		'calendar selection writes day/month/year and restores focus'
	);
	picker.click();
	await until(() => document.activeElement?.classList.contains('day') === true);
	document.activeElement?.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
	);
	await tick();
	await tick();
	check(
		document.activeElement?.getAttribute('aria-label')?.includes('March 1, 2024'),
		'arrow navigation crosses month boundaries'
	);
	document.activeElement?.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
	);
	await tick();
	check(
		dateInput.value === '29/02/2024' &&
			document.activeElement === picker &&
			!calendar.matches(':popover-open'),
		'Escape closes without changing the selected date'
	);
	picker.click();
	await until(() => calendar.matches(':popover-open'));
	(calendar.querySelector('.calendar-footer button') as HTMLButtonElement).click();
	await tick();
	check(dateInput.value === '', 'calendar clear removes the date filter');
	for (const [date, count] of [
		['01/02/2021', 28],
		['31/08/2026', 42]
	] as const) {
		await input('fieldset input[type="text"]', date);
		picker.click();
		await until(
			() => calendar.matches(':popover-open') && calendar.querySelectorAll('.day').length === count
		);
		check(
			calendar.querySelectorAll('.day').length === count,
			`calendar renders all ${count / 7} required weeks`
		);
		calendar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await tick();
	}
	await input('fieldset input[type="text"]', '20/09/2026');
	await input('fieldset .date-field:last-child input[type="text"]', '19/09/2026');
	check(
		target.textContent?.includes('start date is after') && !target.querySelector('.card'),
		'reversed dates show validation without an automatic swap'
	);
	button('Swap dates').click();
	await tick();
	check(
		!!target.querySelector('.card'),
		'explicit date swap includes a report at the end of the final day'
	);
	if (new URLSearchParams(location.search).get('scope') === 'dates') {
		await unmount(app);
		clearAccountStorage();
		return checks;
	}
	await input('input[type="search"]', 'unmatched');
	check(
		target.textContent?.includes('No matching results'),
		'filtered empty state differs from no reports'
	);
	clearAccountStorage();
	await tick();
	check(
		!target.querySelector('.card') && target.textContent?.includes('session'),
		'account clearing removes reports'
	);
	await unmount(app);
	const db = await loadDatabase();
	const record = {
		uniqueId: crypto.randomUUID(),
		versionId: 0,
		lastEdited: 1,
		config: { title: 'English quiz', slides: [] }
	};
	const alias = await addCreation(record, db);
	const creations = [
		{ id: alias, uniqueId: record.uniqueId, title: 'English quiz', lastEdited: 1, slidesCount: 0 },
		{
			id: alias + 1,
			uniqueId: crypto.randomUUID(),
			title: 'ภาษาไทย',
			lastEdited: 2,
			slidesCount: 0
		}
	];
	app = mount(Gallery, {
		target,
		props: { db, creations, publishedIds: new Set([record.uniqueId, String(alias + 1)]) }
	});
	await tick();
	check(
		target.querySelectorAll('.publication-chip').length === 1 &&
			target
				.querySelector('.publication-chip')
				?.closest('.entry')
				?.textContent?.includes('English quiz'),
		'publication badge matches uniqueId, never numeric cache ID'
	);
	for (const el of target.querySelectorAll<HTMLButtonElement>('button.select')) el.click();
	await tick();
	const search = await input('input[type="search"]', ' ENGLISH ');
	check(
		target.querySelectorAll('.entry').length === 1 && document.activeElement === search,
		'English filtering preserves focus'
	);
	check(
		target.textContent?.includes('Deselected 1 hidden') &&
			target.querySelectorAll('.entry.selected').length === 1,
		'hidden selections removed with accessible notice'
	);
	button('Clear filters').click();
	await tick();
	check(
		target.querySelectorAll('.entry').length === 2 &&
			target.querySelectorAll('.entry.selected').length === 1,
		'clear restores items without restoring hidden selections'
	);
	await input('input[type="search"]', 'ภาษาไทย');
	check(target.querySelectorAll('.entry').length === 1, 'Thai gallery search');
	await unmount(app);
	const invalidRecord = {
		...record,
		config: {
			title: 'Validation fixture',
			slides: [{ InfoSlide: { title: '' } }, { InfoSlide: { title: 'Valid' } }]
		}
	};
	app = mount(Editor, { target, props: { database: db, record: invalidRecord, alias } });
	await tick();
	check(
		button('Start').disabled && target.textContent?.includes('Cannot start: slide 1'),
		'visible validation blocks start'
	);
	check(
		button('Generate with AI').disabled &&
			target.textContent?.includes('AI is currently unavailable'),
		'disabled AI explains availability without claiming a cause'
	);
	button('Go to the issue').click();
	await tick();
	await tick();
	check(
		document.activeElement?.id === 'question_title',
		'issue navigation focuses existing title field'
	);
	await input('#question_title', 'Fixed');
	check(
		!button('Start').disabled && !target.textContent?.includes('Cannot start:'),
		'correcting issue enables start'
	);
	await until(() => target.textContent?.includes('Saved to your account') ?? false);
	await unmount(app);
	clearAccountStorage();
	return checks;
}
(globalThis as any).usabilityResult = run().then(
	(checks) => ({ checks }),
	(error) => ({ checks, error: String(error.stack ?? error) })
);
void (globalThis as any).usabilityResult.then((result: { checks: string[]; error?: string }) => {
	const output = document.createElement('pre');
	output.id = 'test-result';
	output.textContent = JSON.stringify(result, null, 2);
	document.body.append(output);
});
