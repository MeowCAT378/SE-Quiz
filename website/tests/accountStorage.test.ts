import { beforeEach, expect, it, vi } from 'vitest';
import {
	addCreation,
	addReport,
	getCreation,
	getLocalCreations,
	loadDatabase,
	updateCreation
} from '../src/lib/storage';
import { clearAccountStorage } from '../src/lib/storage/account';
import * as local from '../src/lib/storage/local';

vi.mock('../src/lib/storage/remoteStorage', () => ({ retrieveRemoteSync: async () => [] }));
vi.mock('../src/lib/storage/local', () => ({
	loadLocalDatabase: vi.fn(async () => ({ close: vi.fn() })),
	getAllCreationsLocal: vi.fn(async () => []),
	getCreationLocal: vi.fn(),
	addCreationLocal: vi.fn(async () => 7),
	updateCreationLocal: vi.fn(),
	deleteCreationLocal: vi.fn(),
	getAllReportsLocal: vi.fn(async () => []),
	getReportLocal: vi.fn(),
	addReportLocal: vi.fn(),
	updateReportLocal: vi.fn(),
	deleteReportLocal: vi.fn(),
	updateLocalImagesDatabase: vi.fn(),
	retrieveMediaFromLocal: vi.fn()
}));
const a = '00000000-0000-4000-a000-000000000001';
const b = '00000000-0000-4000-a000-000000000002';
const record = {
	uniqueId: crypto.randomUUID(),
	versionId: 0,
	lastEdited: 10,
	config: { title: 'Draft', slides: [] }
};
let account: string;
let status: number;
let requests: string[];
beforeEach(() => {
	vi.clearAllMocks();
	account = a;
	status = 200;
	requests = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			requests.push(`${init?.method ?? 'GET'} ${url}`);
			if (url === '/api/account')
				return Response.json({ user: { id: account, role: 'TEACHER' }, sessionIssuedAt: 1 });
			return Response.json(status === 200 ? { record, resources: [] } : { error: 'Rejected' }, {
				status
			});
		})
	);
});
it('resolves a separate cache from server identity and never opens legacy FuizDB', async () => {
	await loadDatabase();
	expect(vi.mocked(local.loadLocalDatabase).mock.calls[0]?.[0]).toBe(a);
});
it('retains a stable report UUID and exact body after an uncertain server failure', async () => {
	const db = await loadDatabase();
	const body = { title: 'Results', playedAt: 1, playerCount: 0, questions: [], results: [] };
	const payloads: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url === '/api/account')
				return Response.json({ user: { id: a, role: 'TEACHER' }, sessionIssuedAt: 1 });
			payloads.push(String(init?.body));
			return Response.json(
				{ record: JSON.parse(String(init?.body)) },
				{ status: payloads.length === 1 ? 503 : 200 }
			);
		})
	);
	await expect(addReport(body, db)).rejects.toMatchObject({ status: 503 });
	expect(local.addReportLocal).not.toHaveBeenCalled();
	await addReport(body, db);
	expect(payloads[0]).toBe(payloads[1]);
	expect(local.addReportLocal).toHaveBeenCalledTimes(1);
});
it('keeps acknowledged private saves successful when optional synchronization fails', async () => {
	const db = await loadDatabase();
	db.remote = {
		create: async () => {
			throw new Error('optional provider unavailable');
		}
	} as never;
	expect(await addCreation(record, db)).toBe(7);
	expect(db.syncWarning).toBe(true);
	expect(local.addCreationLocal).toHaveBeenCalledTimes(1);
	expect(requests.filter((request) => request === 'POST /api/creations')).toHaveLength(1);
});
it('does not resume a private view when logout occurs during optional synchronization', async () => {
	const db = await loadDatabase();
	db.remote = {
		create: async () => {
			clearAccountStorage();
		}
	} as never;
	await expect(addCreation(record, db)).rejects.toMatchObject({ status: 401 });
});
it('rejects a retained reference after account switching before reading its cache', async () => {
	const db = await loadDatabase();
	account = b;
	await expect(getCreation(7, db)).rejects.toMatchObject({ status: 401 });
	expect(local.getCreationLocal).not.toHaveBeenCalled();
	expect(db.local.close).toHaveBeenCalled();
});
it('never commits rejected server writes to the cache and retains the caller draft', async () => {
	const db = await loadDatabase();
	status = 409;
	await expect(addCreation(record, db)).rejects.toMatchObject({ status: 409 });
	expect(local.addCreationLocal).not.toHaveBeenCalled();
	expect(record.versionId).toBe(0);
});
it('fails closed instead of serving cached creations during a server outage', async () => {
	const db = await loadDatabase();
	status = 503;
	await expect(getLocalCreations(db)).rejects.toMatchObject({ status: 503 });
	expect(local.getAllCreationsLocal).not.toHaveBeenCalled();
});
it('writes the acknowledged resource before returning its existing numeric alias', async () => {
	const db = await loadDatabase();
	const id = await addCreation(record, db);
	expect(requests).toContain('POST /api/creations');
	expect(id).toBe(7);
	expect(local.addCreationLocal).toHaveBeenCalledWith(record, db.local);
});
it('does not advance the cached version on a permanent size rejection', async () => {
	const db = await loadDatabase();
	status = 413;
	vi.mocked(local.getCreationLocal).mockResolvedValue(record);
	const draft = { ...record, versionId: 1, config: { title: 'Unsaved', slides: [] } };
	await expect(updateCreation(7, draft, db)).rejects.toMatchObject({ status: 413 });
	expect(local.updateCreationLocal).not.toHaveBeenCalled();
	expect(draft.config.title).toBe('Unsaved');
});
it('rejects an oversized canonical creation before uploading its referenced media', async () => {
	const db = await loadDatabase();
	const value = {
		...record,
		config: {
			title: '',
			slides: Array.from({ length: 33 }, () => ({
				InfoSlide: {
					title: '',
					body: 'ก'.repeat(20000),
					media: { Image: { Base64: { data: 'data:image/png;base64,iVBORw0KGgo=', alt: '' } } }
				}
			}))
		}
	};
	await expect(addCreation(value, db)).rejects.toMatchObject({ status: 413 });
	expect(requests.filter((request) => request.startsWith('PUT'))).toEqual([]);
});
