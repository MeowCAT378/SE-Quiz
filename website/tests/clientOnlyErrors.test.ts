import { afterEach, describe, expect, it, vi } from 'vitest';
import { playBackendReadyIdConfig, playIdlessConfig } from '../src/lib/clientOnly';
import { overwriteGetLocale } from '../src/lib/paraglide/runtime.js';
import type { FuizOptions, IdlessFullFuizConfig } from '../src/lib/types';
import { bring } from '../src/lib/util';

vi.mock('../src/lib/util', () => ({
	bring: vi.fn()
}));

const config: IdlessFullFuizConfig = { title: 'Test quiz', slides: [] };
const options: FuizOptions = {
	random_names: null,
	show_answers: false,
	no_leaderboard: false
};
const mockedBring = vi.mocked(bring);

it.each([
	undefined,
	false,
	true
])('preserves late-join option %s for starts and replays', async (lock) => {
	mockedBring.mockReset();
	const gameOptions: FuizOptions = {
		...options,
		...(lock === undefined ? {} : { lock_after_start: lock })
	};
	mockedBring.mockResolvedValue(undefined);
	await playIdlessConfig(config, gameOptions);
	await playBackendReadyIdConfig({ title: 'Test quiz', slides: [] }, gameOptions);
	expect(mockedBring).toHaveBeenCalledTimes(2);
	for (const [, init] of mockedBring.mock.calls) {
		expect(JSON.parse(init?.body as string).options).toEqual(gameOptions);
	}
});

describe('localized game-start failures', () => {
	it('sends authenticated web creation with origin while preserving time conversion', async () => {
		const origin = { uniqueId: crypto.randomUUID(), versionId: 3 };
		mockedBring.mockResolvedValue(undefined);
		await playIdlessConfig(config, options, origin);
		expect(mockedBring).toHaveBeenCalledWith(
			'/api/add',
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ config, options, origin }) })
		);
	});
	afterEach(() => {
		mockedBring.mockReset();
		overwriteGetLocale(() => 'en');
	});

	it.each([
		{
			name: 'the backend cannot be reached',
			response: undefined,
			expected: 'เชื่อมต่อไม่สำเร็จ โปรดตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง'
		},
		{
			name: 'the backend rejects the quiz',
			response: new Response('Invalid quiz config', { status: 400 }),
			expected: 'เริ่มเกมไม่สำเร็จ โปรดลองอีกครั้ง'
		}
	])('returns Thai copy when $name', async ({ response, expected }) => {
		overwriteGetLocale(() => 'th');
		mockedBring.mockResolvedValueOnce(response);

		await expect(playIdlessConfig(config, options)).resolves.toBe(expected);
	});
});

describe('runtime image uploads', () => {
	const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
	const imageConfig = (data: string): IdlessFullFuizConfig => ({
		title: 'Images',
		slides: [
			{
				Pin: {
					title: 'Pin here',
					points_awarded: 1000,
					media: { Image: { Base64: { data, alt: 'Board' } } }
				}
			}
		]
	});
	afterEach(() => {
		mockedBring.mockReset();
		vi.unstubAllGlobals();
		overwriteGetLocale(() => 'en');
	});

	it.each([
		[800, 400, 800, 400],
		[8000, 4000, 4096, 2048]
	])('uploads SVG as PNG while preserving aspect ratio (%i x %i)', async (width, height, expectedWidth, expectedHeight) => {
		const png = new Blob(['png'], { type: 'image/png' });
		const drawImage = vi.fn();
		const canvas = {
			width: 0,
			height: 0,
			getContext: () => ({ drawImage }),
			toBlob: (callback: BlobCallback, type: string) => {
				expect(type).toBe('image/png');
				callback(png);
			}
		};
		vi.stubGlobal(
			'Image',
			class {
				naturalWidth = width;
				naturalHeight = height;
				decode = async () => {};
			}
		);
		vi.stubGlobal('document', { createElement: () => canvas });
		mockedBring
			.mockResolvedValueOnce(
				new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })
			)
			.mockResolvedValueOnce(Response.json('runtime-image'))
			.mockResolvedValueOnce(undefined);
		const original = imageConfig(svg);
		await playIdlessConfig(original, options);
		const uploaded = (mockedBring.mock.calls[1][1]?.body as FormData).get('image') as Blob;
		expect(uploaded.type).toBe('image/png');
		expect(await uploaded.text()).toBe('png');
		expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, expectedWidth, expectedHeight);
		const submitted = JSON.parse(mockedBring.mock.calls[2][1]?.body as string);
		expect(submitted.config.slides[0].Pin.media).toEqual({
			Image: { Corkboard: { id: 'runtime-image', alt: 'Board' } }
		});
		expect(original).toEqual(imageConfig(svg));
	});

	it('keeps raster images unchanged', async () => {
		mockedBring
			.mockResolvedValueOnce(new Response('gif', { headers: { 'Content-Type': 'image/gif' } }))
			.mockResolvedValueOnce(Response.json('runtime-image'))
			.mockResolvedValueOnce(undefined);
		await playIdlessConfig(imageConfig('data:image/gif;base64,R0lG'), options);
		const uploaded = (mockedBring.mock.calls[1][1]?.body as FormData).get('image') as Blob;
		expect(uploaded.type).toBe('image/gif');
		expect(await uploaded.text()).toBe('gif');
	});

	it('reports the affected slide and stops when SVG cannot be rendered', async () => {
		vi.stubGlobal(
			'Image',
			class {
				decode = async () => {
					throw new Error('Invalid SVG');
				};
			}
		);
		mockedBring.mockResolvedValueOnce(
			new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })
		);
		expect(await playIdlessConfig(imageConfig(svg), options)).toContain('Pin here');
		expect(mockedBring).toHaveBeenCalledTimes(1);
	});
});
