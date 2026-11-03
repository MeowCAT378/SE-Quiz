import JSZip from 'jszip';
import { afterEach, expect, it, vi } from 'vitest';
import { createZip, downloadFuizzes, downloadReportXlsx, loadZip } from '../src/lib/clientOnly';
import type { ReportBody } from '../src/lib/storage';

afterEach(() => vi.unstubAllGlobals());

it('preserves TOML and image bytes through the deferred ZIP module', async () => {
	const blob = await createZip('title = "Archive"\nslides = []', [
		{ name: 'sample.png', base64: 'AQID' }
	]);
	const bytes = await blob.arrayBuffer();
	const zip = await JSZip.loadAsync(bytes);
	expect(await zip.file('sample.png')?.async('base64')).toBe('AQID');
	// JSZip accepts bytes in Node; browsers supply Blob/File through the same import path.
	expect(await loadZip(bytes as unknown as Blob)).toEqual({ title: 'Archive', slides: [] });
});

it('keeps duplicate archive names distinct and authorizes before downloading', async () => {
	const files: File[] = [];
	const click = vi.fn();
	vi.stubGlobal('URL', {
		createObjectURL: (file: File) => {
			files.push(file);
			return 'blob:archive';
		}
	});
	vi.stubGlobal('window', { URL: { revokeObjectURL: vi.fn() } });
	vi.stubGlobal('document', {
		createElement: () => ({ style: {}, click }),
		body: { appendChild: vi.fn(), removeChild: vi.fn() }
	});
	const configs = [
		{ title: 'Same', slides: [] },
		{ title: 'Same', slides: [] }
	];
	const authorize = vi.fn(async () => {
		expect(files).toHaveLength(0);
	});
	await downloadFuizzes(configs, 'export', authorize);
	expect(authorize).toHaveBeenCalledOnce();
	expect(click).toHaveBeenCalledOnce();
	const zip = await JSZip.loadAsync(await files[0].arrayBuffer());
	expect(Object.keys(zip.files)).toEqual(['Same.toml', 'Same (2).toml']);
});

it('propagates revoked authorization after deferred XLSX generation without downloading', async () => {
	const report: ReportBody = {
		title: 'Synthetic report',
		playedAt: 0,
		playerCount: 0,
		questions: [],
		results: []
	};
	const createElement = vi.fn();
	vi.stubGlobal('document', { createElement });
	const authorize = vi.fn(async () => {
		throw new Error('revoked');
	});
	await expect(downloadReportXlsx(report, authorize)).rejects.toThrow('revoked');
	expect(authorize).toHaveBeenCalledOnce();
	expect(createElement).not.toHaveBeenCalled();
});
