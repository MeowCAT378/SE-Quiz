import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';
import { FilesystemBlobStorage } from '../src/lib/blob/filesystem';
import { R2BlobStorage } from '../src/lib/blob/r2';
import { D1PrivateResourceStore } from '../src/lib/server/privateResourcesD1';
import { exercisePrivateFailures } from './privateFailureChecks';
import { exercisePrivateStore } from './privateStoreChecks';
import { exercisePrivateUpgrade } from './privateUpgradeChecks';

it('adds private media and import provenance without rewriting populated resource bodies', async () => {
	const runtime = new Miniflare({
		modules: true,
		script: 'export default { fetch(){ return new Response("ok") } }',
		compatibilityDate: '2026-06-07',
		d1Databases: ['DATABASE'],
		r2Buckets: ['BUCKET']
	});
	try {
		const db = (await runtime.getD1Database('DATABASE')) as unknown as D1Database;
		const source = readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
		const apply = async (source: string) => {
			const schema = source
				.replace(/--[^\n]*/g, '')
				.split(/;\s*(?=CREATE|$)/i)
				.map((s) => s.trim())
				.filter(Boolean);
			await db.batch(schema.map((s) => db.prepare(s)));
		};
		await apply(source.split('-- Additive private storage upgrade:')[0]);
		await exercisePrivateUpgrade(
			async (sql, params = []) =>
				(
					await db
						.prepare(sql)
						.bind(...params)
						.all()
				).results,
			() => apply(source)
		);
		const tables = (
			await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()
		).results.map((r) => r.name);
		expect(tables).toEqual(expect.arrayContaining(['host_media', 'host_imports']));
		const dir = await mkdtemp(join(tmpdir(), 'seopen-private-'));
		try {
			await exercisePrivateStore(
				new D1PrivateResourceStore(db, new FilesystemBlobStorage(dir)),
				async (sql, params = []) =>
					(
						await db
							.prepare(sql)
							.bind(...params)
							.all()
					).results
			);
			await exercisePrivateFailures(
				(blob) => new D1PrivateResourceStore(db, blob),
				new FilesystemBlobStorage(dir),
				async (sql, params = []) =>
					(
						await db
							.prepare(sql)
							.bind(...params)
							.all()
					).results
			);
			const bucket = (await runtime.getR2Bucket('BUCKET')) as unknown as R2Bucket;
			await exercisePrivateFailures(
				(blob) => new D1PrivateResourceStore(db, blob),
				new R2BlobStorage(bucket),
				async (sql, params = []) =>
					(
						await db
							.prepare(sql)
							.bind(...params)
							.all()
					).results
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	} finally {
		await runtime.dispose();
	}
}, 60000);
