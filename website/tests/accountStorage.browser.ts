import { mount, unmount } from 'svelte';
import {
	addCreation,
	clearAccountStorage,
	getCreation,
	getLocalCreations,
	loadDatabase
} from '../src/lib/storage';
import {
	prepareLegacyPreview,
	readLegacyBrowser,
	selectedLegacyImport
} from '../src/lib/storage/legacy';
import { addCreationLocal, getCreationLocal, loadLocalDatabase } from '../src/lib/storage/local';
import { authorizeReportExport } from '../src/lib/storage/privateExport';
import LegacyImport from '../src/routes/[[lang=locale]]/admin/import/+page.svelte';
import Summary from '../src/routes/[[lang=locale]]/host/Summary.svelte';
import Share from '../src/routes/[[lang=locale]]/share/[id]/+page.svelte';
import Editor from './BrowserEditor.svelte';
import { reviewChecks } from './task6Review.browser';

const results: string[] = [];
const assert = (condition: unknown, label: string) => {
	if (!condition) throw new Error(label);
	results.push(label);
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const a = '00000000-0000-4000-a000-000000000001',
	b = '00000000-0000-4000-a000-000000000002';
let account: string | null = a,
	failure = 0,
	writes = 0;
let release: (() => void) | undefined;
let hold = false;
const records = new Map<string, any>();
const versions: number[] = [];
const imports: string[] = [];
let importFailure = 0;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input),
		method = init?.method ?? 'GET';
	if (url === '/api/account')
		return Response.json(
			account ? { user: { id: account, role: 'ADMIN' }, sessionIssuedAt: 1 } : {},
			{ status: account ? 200 : 401 }
		);
	if (url === '/api/gdrive/status')
		return Response.json({ authenticated: false, available: false });
	const headers = new Headers(init?.headers);
	if (!account || headers.get('x-seopen-account') !== account)
		return Response.json({}, { status: 401 });
	if (url === '/api/admin/import') {
		imports.push(String(init?.body));
		return Response.json({ imports: [{}] }, { status: importFailure || 200 });
	}
	if (url.startsWith('/api/host/instances/')) return Response.json({}, { status: 404 });
	if (failure && method === 'GET') return Response.json({}, { status: failure });
	const id = url.split('/')[3];
	if (url.startsWith('/api/creations')) {
		if (method === 'GET')
			return id
				? Response.json(records.has(account + id) ? { record: records.get(account + id) } : {}, {
						status: records.has(account + id) ? 200 : 404
					})
				: Response.json({
						resources: [...records]
							.filter(([key]) => key.startsWith(account!))
							.map(([, record]) => ({ record }))
					});
		const body = JSON.parse(String(init?.body));
		const record = body.record ?? body;
		writes++;
		versions.push(record.versionId);
		if (hold) {
			hold = false;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}
		if (failure) return Response.json({}, { status: failure });
		records.set(account + record.uniqueId, record);
		return Response.json({ record });
	}
	return Response.json({}, { status: 404 });
}) as typeof window.fetch;

async function run() {
	const old = {
		lastEdited: 12,
		config: {
			title: 'Legacy original',
			slides: [{ InfoSlide: { title: '', media: 'legacy-image' } }]
		}
	};
	const source = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('FuizDB', 3);
		request.onupgradeneeded = () => {
			for (const name of ['creations', 'reports', 'images']) request.result.createObjectStore(name);
		};
		request.onerror = reject;
		request.onsuccess = () => resolve(request.result);
	});
	await new Promise<void>((resolve) => {
		const tx = source.transaction(['creations', 'images'], 'readwrite');
		tx.objectStore('creations').put(old, 7);
		tx.objectStore('images').put('data:image/png;base64,AA==', 'legacy-image');
		tx.oncomplete = () => resolve();
	});
	source.close();
	const before = JSON.stringify(await readLegacyBrowser());
	const preview = prepareLegacyPreview(await readLegacyBrowser());
	const selection = selectedLegacyImport(preview, [0], false);
	assert(
		selection.records[0].sourceId === 'creations:7' && selection.media.length === 1,
		'legacy preview preserves key provenance and resolves old media'
	);
	assert(
		before === JSON.stringify(await readLegacyBrowser()),
		'legacy database bytes unchanged after preview and selection'
	);
	const one = await loadLocalDatabase(a),
		two = await loadLocalDatabase(b);
	const record = {
		uniqueId: crypto.randomUUID(),
		versionId: 0,
		lastEdited: 1,
		config: { title: 'Initial', slides: [] }
	};
	const oneId = await addCreationLocal(record, one),
		twoId = await addCreationLocal({ ...record, config: { title: 'Other', slides: [] } }, two);
	assert(
		oneId === twoId && (await getCreationLocal(twoId, two))?.config.title === 'Other',
		'reused numeric aliases are isolated across account databases'
	);
	assert(
		(await addCreationLocal({ ...record, lastEdited: 2 }, one)) === oneId,
		'server UUID upsert retains its numeric alias'
	);
	const realTransaction = one.transaction.bind(one);
	one.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const tx = realTransaction(...args);
		const objectStore = tx.objectStore.bind(tx);
		tx.objectStore = (name) => {
			const store = objectStore(name);
			const put = store.put.bind(store);
			store.put = (...values) => {
				const request = put(...values);
				request.addEventListener('success', () => tx.abort());
				return request;
			};
			return store;
		};
		return tx;
	}) as IDBDatabase['transaction'];
	let rejected = false;
	try {
		await addCreationLocal({ ...record, lastEdited: 9 }, one);
	} catch {
		rejected = true;
	}
	one.transaction = realTransaction;
	assert(
		rejected && (await getCreationLocal(oneId, one))?.lastEdited === 2,
		'request success followed by real IndexedDB abort rejects and preserves cache'
	);
	one.close();
	two.close();
	const db = await loadDatabase();
	const alias = await addCreation(record, db);
	const app = mount(Editor, {
		target: document.querySelector('#editor')!,
		props: { database: db, record, alias }
	});
	await pause(200);
	const title = document.querySelector<HTMLInputElement>('#title')!;
	const edit = (value: string) => {
		title.value = value;
		title.dispatchEvent(new Event('input', { bubbles: true }));
	};
	hold = true;
	edit('First');
	await pause(700);
	edit('Latest');
	await pause(700);
	assert(
		(await getCreationLocal(alias, db.local))?.versionId === 0,
		'editor cache stays at acknowledged version while write pending'
	);
	release!();
	await pause(600);
	assert(
		(await getCreationLocal(alias, db.local))?.config.title === 'Latest' &&
			versions.slice(-2).join(',') === '1,2',
		'rapid editor changes serialize and advance versions after each ACK'
	);
	failure = 409;
	edit('Conflict unsaved');
	await pause(750);
	assert(
		title.value === 'Conflict unsaved' && document.body.textContent!.includes('newer'),
		'conflict feedback preserves unsaved editor content'
	);
	failure = 0;
	const retry = [...document.querySelectorAll('button')].find((button) =>
		button.textContent?.includes('Retry')
	);
	retry?.click();
	await pause(500);
	assert(
		(await getCreationLocal(alias, db.local))?.config.title === 'Conflict unsaved',
		'explicit retry succeeds without losing the draft'
	);
	failure = 413;
	edit('Too large');
	await pause(750);
	const attempts = writes;
	await pause(650);
	assert(
		writes === attempts &&
			title.value === 'Too large' &&
			document.body.textContent!.includes('This record is too large to save.'),
		'permanent 413 preserves draft and does not loop automatic retries'
	);
	failure = 0;
	edit('Smaller');
	await pause(750);
	assert(
		(await getCreationLocal(alias, db.local))?.config.title === 'Smaller',
		'editing after size rejection can save a new candidate'
	);
	await unmount(app);
	failure = 503;
	rejected = false;
	try {
		await getLocalCreations(db);
	} catch {
		rejected = true;
	}
	assert(rejected, 'server outage does not expose cached list fallback');
	failure = 0;
	account = b;
	rejected = false;
	try {
		await getCreation(alias, db);
	} catch {
		rejected = true;
	}
	assert(
		rejected && db.closed,
		'account switch closes retained database reference and refuses cached creation'
	);
	const dbB = await loadDatabase();
	rejected = false;
	try {
		await authorizeReportExport(
			{
				title: '',
				playedAt: 1,
				playerCount: 0,
				questions: [],
				results: [],
				gameInstanceId: crypto.randomUUID()
			},
			dbB
		);
	} catch {
		rejected = true;
	}
	assert(rejected, 'cached host summary export denied without owned server instance');
	clearAccountStorage();
	rejected = false;
	try {
		await getCreation(alias, dbB);
	} catch {
		rejected = true;
	}
	assert(rejected && dbB.closed, 'explicit logout invalidates all retained references');
	assert(
		before === JSON.stringify(await readLegacyBrowser()),
		'normal account operations never modify legacy records or media'
	);
	account = null;
	const publicShare = mount(Share, {
		target: document.querySelector('#editor')!,
		props: { data: { fuiz: record.config, user: null } as never }
	});
	await pause(150);
	assert(
		document.body.textContent!.includes('Initial') &&
			document.body.textContent!.includes('Sign in to import'),
		'anonymous share renders public preview and sign-in import action without a private cache'
	);
	await unmount(publicShare);
	account = a;
	const user = (id: string, deletedAt: string | null = null) => ({
		id,
		email: `${id}@example.test`,
		role: 'ADMIN' as const,
		createdAt: '2020-01-01T00:00:00Z',
		deletedAt
	});
	const adminApp = mount(LegacyImport, {
		target: document.querySelector('#editor')!,
		props: { data: { users: [user(a), user(b), user('deleted', '2020-01-01')], currentUserId: a } }
	});
	const clickText = (text: string, within: ParentNode = document) => {
		const button = [...within.querySelectorAll('button')].find(
			(button) => button.textContent?.trim() === text
		);
		if (!button) throw new Error(`Missing button ${text}`);
		button.click();
	};
	await pause(150);
	clickText('Preview source');
	await pause(350);
	assert(
		document.body.textContent!.includes('Legacy original') &&
			document.querySelectorAll('details img').length === 1,
		'ADMIN browser preview shows copied records and referenced media'
	);
	assert(
		![...document.querySelectorAll('option')].some((option) => option.value === 'deleted'),
		'ADMIN import target picker excludes deleted accounts'
	);
	const checkbox = document.querySelector<HTMLInputElement>('section input[type=checkbox]')!;
	checkbox.click();
	const target = [...document.querySelectorAll('select')].at(-1)!;
	target.value = b;
	target.dispatchEvent(new Event('change', { bubbles: true }));
	await pause(100);
	clickText('Copy selected records');
	await pause(150);
	assert(
		imports.length === 0 && !!document.querySelector('dialog[open]'),
		'legacy import requires explicit confirmation before any write'
	);
	importFailure = 503;
	clickText('Copy selected records', document.querySelector('dialog')!);
	await pause(350);
	assert(
		imports.length === 1 && before === JSON.stringify(await readLegacyBrowser()),
		'failed ADMIN import preserves the original browser source'
	);
	importFailure = 0;
	clickText('Copy selected records');
	await pause(100);
	clickText('Copy selected records', document.querySelector('dialog')!);
	await pause(350);
	assert(
		imports.length === 2 && imports[0] === imports[1] && JSON.parse(imports[1]).targetId === b,
		'ADMIN import retry preserves exact selection and explicit target'
	);
	await unmount(adminApp);
	clearAccountStorage();
	account = a;
	const summary = mount(Summary, {
		target: document.querySelector('#editor')!,
		props: {
			stats: [],
			player_count: 1,
			config: { title: 'Owned summary', slides: [] },
			options: { random_names: null, show_answers: false, no_leaderboard: false },
			results: { Player: [] },
			code: '12345',
			gameInstanceId: crypto.randomUUID()
		}
	});
	await pause(250);
	let downloads = 0;
	const realClick = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function () {
		if (this.download) downloads++;
		else realClick.call(this);
	};
	clickText('Export Excel');
	await pause(200);
	assert(
		downloads === 0 && document.body.textContent!.includes('Could not export'),
		'unowned cached host summary cannot export Excel through the actual UI'
	);
	account = null;
	const csv = [...document.querySelectorAll('button')].find((button) =>
		button.textContent?.includes('Download Results')
	);
	if (!csv) throw new Error('CSV export action absent');
	csv.click();
	await pause(200);
	assert(
		downloads === 0 && document.body.textContent!.includes('session'),
		'expired cached host summary cannot export CSV through the actual UI'
	);
	HTMLAnchorElement.prototype.click = realClick;
	await unmount(summary);
	clearAccountStorage();
	const review = await reviewChecks();
	results.push(...review.checks);
	if (review.errors.length) throw new Error(review.errors.join('\n'));
	return results;
}
(globalThis as any).task6Result = run().then(
	(checks) => ({ checks }),
	(error) => ({ checks: results, error: String(error.stack ?? error) })
);
