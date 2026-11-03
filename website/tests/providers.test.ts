import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { afterEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('$env/dynamic/private', () => ({ env }));

import { createDatabase } from '../src/lib/db/factory';
import { PostgresDatabase } from '../src/lib/db/postgres';
import { createKVStore } from '../src/lib/kv/factory';
import { PostgresKVStore } from '../src/lib/kv/postgres';

afterEach(() => {
	for (const key of Object.keys(env)) delete env[key];
	vi.unstubAllGlobals();
});

it('uses Cloudflare bindings by default and respects explicit missing bindings', async () => {
	expect((await createDatabase({} as D1Database))?.constructor.name).toBe('D1DatabaseAdapter');
	expect((await createKVStore({} as KVNamespace))?.constructor.name).toBe('CloudflareKVStore');
	env.DB_PROVIDER = 'd1';
	env.KV_PROVIDER = 'cloudflare';
	expect(await createDatabase()).toBeUndefined();
	expect(await createKVStore()).toBeUndefined();
});

it('does not create PostgreSQL services without configuration', async () => {
	env.DB_PROVIDER = 'postgres';
	env.KV_PROVIDER = 'postgres';
	expect(await createDatabase()).toBeUndefined();
	expect(await createKVStore(undefined, 'share')).toBeUndefined();
});

it('selects PostgreSQL locally and honors explicit overrides of Cloudflare bindings', async () => {
	// Vitest uses Node; native SQL execution is covered by the Bun integration check.
	vi.stubGlobal('Bun', { SQL: class {} });
	env.DATABASE_URL = 'postgres://localhost/fuiz_test';
	expect(await createDatabase()).toBeInstanceOf(PostgresDatabase);
	expect(await createKVStore(undefined, 'share')).toBeInstanceOf(PostgresKVStore);
	env.DB_PROVIDER = 'postgres';
	env.KV_PROVIDER = 'postgres';
	expect(await createDatabase({} as D1Database)).toBeInstanceOf(PostgresDatabase);
	expect(await createKVStore({} as KVNamespace, 'jobs')).toBeInstanceOf(PostgresKVStore);
	expect(await createKVStore()).toBeUndefined();
});
