import { describe, expect, it, vi } from 'vitest';
import {
	prepareLegacyPreview,
	readLegacyBrowser,
	selectedLegacyImport
} from '../src/lib/storage/legacy';

describe('explicit legacy preview', () => {
	it('normalizes old media in the preview copy and preserves original identifiers and bytes', () => {
		const original = {
			records: [
				{
					kind: 'creation' as const,
					sourceId: 'creations:7',
					record: {
						lastEdited: 1,
						config: { title: 'Legacy', slides: [{ InfoSlide: { title: '', media: 'old-image' } }] }
					}
				}
			],
			media: [
				{
					id: 'old-image',
					media: { Image: { Base64: { data: 'data:image/png;base64,AA==', alt: '' } } }
				}
			]
		};
		const before = JSON.stringify(original);
		const preview = prepareLegacyPreview(original);
		expect(JSON.stringify(preview.records[0].record)).toContain('HashReference');
		expect(preview.records[0].record.uniqueId).toBeUndefined();
		expect(JSON.stringify(original)).toBe(before);
	});
	it('does not create an absent legacy database', async () => {
		const open = vi.fn();
		vi.stubGlobal('indexedDB', { databases: async () => [], open });
		expect(await readLegacyBrowser()).toEqual({ records: [], media: [] });
		expect(open).not.toHaveBeenCalled();
	});
	it('copies only selected records and referenced media without changing source bytes', () => {
		const preview = {
			records: [
				{
					kind: 'creation' as const,
					sourceId: 'old',
					record: { config: { media: { Image: { HashReference: { hash: 'used', alt: '' } } } } }
				},
				{ kind: 'report' as const, sourceId: 'other', record: {} }
			],
			media: [
				{ id: 'used', media: {} },
				{ id: 'unused', media: {} }
			]
		};
		const before = JSON.stringify(preview);
		const request = selectedLegacyImport(preview, [0], false);
		expect(request.records).toHaveLength(1);
		expect(request.media.map((item) => item.id)).toEqual(['used']);
		expect(JSON.stringify(preview)).toBe(before);
	});
});
