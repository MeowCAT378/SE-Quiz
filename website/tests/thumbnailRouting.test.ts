import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const privateEnv = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_CORKBOARD_URL: 'http://localhost:9504' } }));

import { getThumbnail } from '../src/lib/serverOnlyUtils';
import type { IdlessFullFuizConfig } from '../src/lib/types';

beforeEach(() => {
	// The Node test runner predates this native Bun/browser API.
	vi.stubGlobal(
		'Uint8Array',
		class extends Uint8Array {
			static fromBase64(value: string) {
				return new Uint8Array(Buffer.from(value, 'base64'));
			}
		}
	);
});

afterEach(() => {
	delete privateEnv.CORKBOARD_INTERNAL_URL;
	vi.unstubAllGlobals();
});

it.each([
	undefined,
	'http://corkboard:5040'
])('routes server thumbnails with private override %s', async (url) => {
	if (url) privateEnv.CORKBOARD_INTERNAL_URL = url;
	const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));
	vi.stubGlobal('fetch', fetch);
	const config = {
		title: 'Thumbnail test',
		slides: [
			{
				InfoSlide: {
					title: 'Image',
					media: { Image: { Base64: { data: 'data:image/png;base64,AA==', alt: 'Test image' } } }
				}
			}
		]
	} as IdlessFullFuizConfig;
	expect((await getThumbnail(config))?.thumbnailAlt).toBe('Test image');
	expect(fetch.mock.calls[0][0]).toBe((url ?? 'http://localhost:9504') + '/thumbnail');
});
