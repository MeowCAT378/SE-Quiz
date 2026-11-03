import { beforeEach, expect, it, vi } from 'vitest';
import { getPrivateResourceStore } from '../src/lib/server/privateResourceStore';
import { GET as publicationsAlias } from '../src/routes/admin-api/publications/+server';
import { GET as publications } from '../src/routes/api/admin/publications/+server';

vi.mock('../src/lib/server/privateResourceStore', () => ({ getPrivateResourceStore: vi.fn() }));
vi.mock('$lib/serverOnlyUtils', () => ({ getThumbnail: async () => undefined }));

import { POST as removeAlias } from '../src/routes/admin-api/delete/+server';
import { POST as publishAlias } from '../src/routes/admin-api/publish/+server';
import { POST as remove } from '../src/routes/api/admin/delete/+server';
import { POST as publish } from '../src/routes/api/admin/publish/+server';

const id = '11111111-1111-4111-8111-111111111111';
const database = {
	getPublishedIds: vi.fn(),
	getById: vi.fn(),
	deleteFuiz: vi.fn(),
	insertFuiz: vi.fn()
};
const blobStorage = { put: vi.fn(), delete: vi.fn() };
function event(body: unknown, role: string | null = 'ADMIN', origin = 'http://localhost') {
	const url = new URL('http://localhost/api/admin/publish');
	return {
		url,
		request: new Request(url, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }),
		locals: {
			user: role ? { id: 'admin', role, sessionVersion: 0 } : null,
			session: role ? {} : null,
			isAdmin: role === 'ADMIN',
			database,
			blobStorage
		}
	} as never;
}
beforeEach(() => {
	vi.clearAllMocks();
	database.getById.mockResolvedValue(null);
});
for (const [name, publishHandler, deleteHandler] of [
	['api', publish, remove],
	['alias', publishAlias, removeAlias]
] as const) {
	it(`${name}: does not delete unindexed private blobs`, async () => {
		expect((await deleteHandler(event({ id }))).status).toBe(404);
		expect(blobStorage.delete).not.toHaveBeenCalled();
		expect(database.deleteFuiz).not.toHaveBeenCalled();
	});
	it.each([
		'private/owner/media',
		'../private',
		'',
		123
	])(`${name}: rejects non-UUID publishing id %j`, async (badId) => {
		expect(
			(await publishHandler(event({ id: badId, config: { title: 'test', slides: [] } }))).status
		).toBe(400);
		expect(blobStorage.put).not.toHaveBeenCalled();
	});
	it(`${name}: retains indexed public deletion`, async () => {
		database.getById.mockResolvedValueOnce({ id });
		expect((await deleteHandler(event({ id }))).status).toBe(200);
		expect(blobStorage.delete).toHaveBeenCalledWith(id);
		expect(database.deleteFuiz).toHaveBeenCalledWith(id);
	});
	it(`${name}: enforces origin before mutation`, async () => {
		await expect(
			publishHandler(
				event({ config: { title: 'test', slides: [] } }, 'ADMIN', 'http://attacker.test')
			)
		).rejects.toMatchObject({ status: 403 });
		expect(blobStorage.put).not.toHaveBeenCalled();
	});
	it(`${name}: retains ADMIN-only mutation`, async () => {
		await expect(deleteHandler(event({ id }, 'TEACHER'))).rejects.toMatchObject({ status: 403 });
		expect(blobStorage.delete).not.toHaveBeenCalled();
	});
	it(`${name}: provider error is generic 503`, async () => {
		database.getById.mockRejectedValueOnce(new Error('sentinel-private-error'));
		const response = await deleteHandler(event({ id }));
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain('sentinel-private-error');
	});
}

for (const [name, handler] of [
	['api', publications],
	['alias', publicationsAlias]
] as const) {
	it(`${name}: lists IDs only without caching`, async () => {
		database.getPublishedIds.mockResolvedValueOnce([id]);
		const response = await handler(event(null));
		expect(await response.json()).toEqual({ publishedIds: [id] });
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(database.getById).not.toHaveBeenCalled();
	});
	it.each([null, 'TEACHER'])(`${name}: rejects enumeration by %s`, async (role) => {
		await expect(handler(event(null, role))).rejects.toMatchObject({ status: role ? 403 : 401 });
		expect(database.getPublishedIds).not.toHaveBeenCalled();
	});
	it(`${name}: hides provider errors`, async () => {
		database.getPublishedIds.mockRejectedValueOnce(new Error('sentinel-secret'));
		const response = await handler(event(null));
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain('sentinel-secret');
	});
}
for (const handler of [remove, removeAlias]) {
	it('rejects anonymous, cross-origin and invalid UUID deletion', async () => {
		await expect(handler(event({ id }, null))).rejects.toMatchObject({ status: 401 });
		await expect(handler(event({ id }, 'ADMIN', 'https://attacker.test'))).rejects.toMatchObject({
			status: 403
		});
		expect((await handler(event({ id: '../private' }))).status).toBe(400);
		expect(blobStorage.delete).not.toHaveBeenCalled();
	});
	it('never invokes private resource deletion', async () => {
		const request = event({ id });
		database.getById.mockResolvedValueOnce({ id });
		expect((await handler(request)).status).toBe(200);
		expect(getPrivateResourceStore).not.toHaveBeenCalled();
	});
}

it('filesystem removal failures return 503 without deleting the public record', async () => {
	const { mkdtemp, mkdir, rmdir } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { FilesystemBlobStorage } = await import('../src/lib/blob/filesystem');
	const directory = await mkdtemp(join(tmpdir(), 'publication-delete-'));
	const blobPath = join(directory, `${id}.json`);
	try {
		const storage = new FilesystemBlobStorage(directory);
		await expect(storage.delete(id)).resolves.toBeUndefined();
		await mkdir(blobPath);
		const request = event({ id }) as any;
		request.locals.blobStorage = storage;
		database.getById.mockResolvedValueOnce({ id });
		const response = await remove(request);
		expect(response.status).toBe(503);
		expect(await response.text()).toBe('{"error":"Library service unavailable"}');
		expect(database.deleteFuiz).not.toHaveBeenCalled();
	} finally {
		await rmdir(blobPath);
		await rmdir(directory);
	}
});
