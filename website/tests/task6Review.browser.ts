import { mount, tick, unmount } from 'svelte';
import { addCreation, clearAccountStorage, loadDatabase } from '../src/lib/storage';
import { addReportLocal } from '../src/lib/storage/local';
import Gallery from '../src/routes/[[lang=locale]]/create/Gallery.svelte';
import ReportTitle from '../src/routes/[[lang=locale]]/reports/[id]/ReportTitle.svelte';
import Editor from './BrowserEditor.svelte';
import PublicSource from './BrowserPublicSource.svelte';
import { attemptNavigation, completedNavigations } from './browserFramework';

export async function reviewChecks() {
	const checks: string[] = [],
		errors: string[] = [];
	const realFetch = window.fetch;
	const actor = crypto.randomUUID();
	const records = new Map<string, any>();
	const writes: any[] = [],
		deletes: string[] = [];
	let failure = 0,
		deleteFailure = '',
		release: (() => void) | undefined,
		hold = false;
	window.fetch = (async (url: string, init?: RequestInit) => {
		if (url === '/api/account')
			return Response.json({ user: { id: actor, role: 'TEACHER' }, sessionIssuedAt: 1 });
		if (url === '/api/gdrive/status')
			return Response.json({ available: false, authenticated: false });
		const method = init?.method ?? 'GET',
			id = url.split('/')[3];
		if (method === 'DELETE') {
			deletes.push(id);
			if (id === deleteFailure) return Response.json({}, { status: 503 });
			records.delete(id);
			return new Response(null, { status: 204 });
		}
		if (method === 'GET') return Response.json({ record: records.get(id) });
		const body = JSON.parse(String(init?.body)),
			record = body.record ?? body;
		writes.push(structuredClone(record));
		if (hold) {
			hold = false;
			await new Promise<void>((done) => {
				release = done;
			});
		}
		if (failure) return Response.json({}, { status: failure });
		records.set(record.uniqueId, record);
		return Response.json({ record });
	}) as typeof fetch;
	const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms));
	const target = document.querySelector('#editor')!;
	const check = (value: unknown, label: string) => {
		if (!value) throw new Error(label);
		checks.push(label);
	};
	const click = (label: string) => {
		const button = [...target.querySelectorAll('button')].find(
			(item) => item.textContent?.trim() === label
		);
		if (!button) throw new Error(`Missing button ${label}`);
		button.click();
	};
	async function test(name: string, run: () => Promise<void>) {
		try {
			await run();
		} catch (cause) {
			errors.push(`${name}: ${cause}`);
		}
	}
	for (const kind of ['editor', 'report'] as const)
		await test(kind, async () => {
			const db = await loadDatabase();
			const record = {
				uniqueId: crypto.randomUUID(),
				versionId: 0,
				lastEdited: 1,
				config: { title: 'Initial', slides: [] }
			};
			let app: ReturnType<typeof mount>;
			if (kind === 'editor') {
				const alias = await addCreation(record, db);
				app = mount(Editor, { target, props: { database: db, record, alias } });
			} else {
				const report = {
					uniqueId: record.uniqueId,
					versionId: 0,
					lastEdited: 1,
					title: 'Initial',
					playedAt: 1,
					playerCount: 0,
					questions: [],
					results: []
				};
				records.set(report.uniqueId, report);
				const id = await addReportLocal(report, db.local);
				app = mount(ReportTitle, { target, props: { id, report, database: db } });
			}
			try {
				await tick();
				const input = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(
					'input[type="text"], input:not([type]), textarea'
				)!;
				input.value = 'Before navigation';
				input.dispatchEvent(new Event('input', { bubbles: true }));
				await tick();
				const navigations = completedNavigations.length;
				hold = true;
				check(attemptNavigation(), `${kind}: navigation before debounce is blocked`);
				await pause();
				check(
					completedNavigations.length === navigations,
					`${kind}: waits for acknowledgement before navigation`
				);
				release!();
				await pause();
				check(
					completedNavigations.length === navigations + 1 &&
						(writes.at(-1).title ?? writes.at(-1).config.title) === 'Before navigation',
					`${kind}: navigates only after saving the pending draft`
				);
				failure = 503;
				input.value = 'Retained failure';
				input.dispatchEvent(new Event('input', { bubbles: true }));
				await tick();
				check(attemptNavigation(), `${kind}: failed pending edit blocks navigation`);
				await pause();
				check(
					input.value === 'Retained failure' &&
						target.textContent?.includes('Not saved') &&
						completedNavigations.length === navigations + 1,
					`${kind}: failed navigation save retains draft and feedback`
				);
				failure = 0;
			} finally {
				release?.();
				hold = false;
				failure = 0;
				await unmount(app);
				clearAccountStorage();
			}
		});
	await test('bulk delete', async () => {
		const db = await loadDatabase();
		const creations: import('../src/lib/types').Creation[] = [];
		for (const title of ['Delete A', 'Delete B']) {
			const record = {
				uniqueId: crypto.randomUUID(),
				versionId: 0,
				lastEdited: 1,
				config: { title, slides: [] }
			};
			const id = await addCreation(record, db);
			creations.push({ id, uniqueId: record.uniqueId, title, lastEdited: 1, slidesCount: 0 });
		}
		deleteFailure = creations[1].uniqueId;
		const app = mount(Gallery, { target, props: { db, creations } });
		try {
			await tick();
			for (const button of target.querySelectorAll<HTMLButtonElement>('button.select'))
				button.click();
			await tick();
			target.querySelector<HTMLButtonElement>('.selactions button:last-child')!.click();
			await tick();
			target
				.querySelector<HTMLButtonElement>('dialog[open] .actions .action:last-child button')!
				.click();
			await pause();
			check(
				target.querySelectorAll('.entry').length === 1 && target.textContent?.includes('Delete B'),
				'bulk: acknowledged deletions disappear while failed selection stays'
			);
			deleteFailure = '';
			click('Retry');
			await pause();
			check(
				deletes.filter((id) => id === creations[1].uniqueId).length === 2 &&
					target.querySelectorAll('.entry').length === 0,
				'bulk: Retry deletes the original failed selection'
			);
		} finally {
			deleteFailure = '';
			await unmount(app);
			clearAccountStorage();
		}
	});
	for (const library of [false, true])
		await test(library ? 'library source' : 'share source', async () => {
			const app = mount(PublicSource, { target, props: { library } });
			try {
				await tick();
				failure = 503;
				click('Import');
				await pause();
				const first = writes.at(-1);
				click('Import');
				await pause();
				check(
					JSON.stringify(first) === JSON.stringify(writes.at(-1)),
					`${library ? 'library' : 'share'}: same source retry keeps exact candidate`
				);
				app.changeSource();
				await tick();
				failure = 0;
				click('Import');
				await pause();
				check(
					writes.at(-1).config.title === 'Source B' && writes.at(-1).uniqueId !== first.uniqueId,
					`${library ? 'library' : 'share'}: reused component imports displayed new source with new UUID`
				);
			} finally {
				failure = 0;
				await unmount(app);
				clearAccountStorage();
			}
		});
	window.fetch = realFetch;
	return { checks, errors };
}
