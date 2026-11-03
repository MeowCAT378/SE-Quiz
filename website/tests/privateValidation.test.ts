import { expect, it } from 'vitest';
import { canonical, validateMedia, validateRecord } from '../src/lib/server/privateValidation';
import { privateRecordBytes } from './privateResourceSizeFixtures';
import { png } from './privateStoreChecks';

const creation = {
	uniqueId: '00000000-0000-4000-a000-000000000001',
	versionId: 0,
	lastEdited: 0,
	config: { title: '', slides: [] as unknown[] }
};
it.each([
	'creation',
	'report'
] as const)('enforces a provider-safe canonical UTF-8 byte boundary for %s', (kind) => {
	for (const bytes of [1_899_999, 1_900_000, 1_900_001]) {
		const record = privateRecordBytes(kind, bytes);
		expect(Buffer.byteLength(canonical(record), 'utf8')).toBe(bytes);
		if (bytes <= 1_900_000) expect(validateRecord(kind, record).record).toEqual(record);
		else
			expect(() => validateRecord(kind, record)).toThrow(expect.objectContaining({ status: 413 }));
	}
});
it('retains incomplete drafts and all slide discriminators without applying play-ready lint', () => {
	const common = { title: '', points_awarded: 0, time_limit: null };
	const slides = [
		{ MultipleChoice: { ...common, answers: [{ correct: false, content: { Text: '' } }] } },
		{ TypeAnswer: { ...common, answers: [''], case_sensitive: false } },
		{ Order: { ...common, answers: [], axis_labels: { from: '', to: '' } } },
		{ Slider: { ...common, range: { min: 0, max: 0, step: 0 }, correct: 0, tolerance: 0 } },
		{ Scale: { ...common, min: 0, max: 0, style: 'Agreement', labels: { low: null } } },
		{ Poll: { ...common, answers: [{ Text: '' }] } },
		{ Pin: { ...common, correct_area: { Polygon: { points: [] } } } },
		{ FreeText: { ...common, mode: 'WordCloud', max_entries: 0, max_entry_length: 0 } },
		{
			Brainstorm: {
				title: '',
				points_awarded: 0,
				max_ideas_per_player: 0,
				max_votes_per_player: 0,
				max_idea_length: 0
			}
		},
		{ InfoSlide: { title: '', body: null } }
	];
	expect(validateRecord('creation', { ...creation, config: { title: '', slides } }).record).toEqual(
		{ ...creation, config: { title: '', slides } }
	);
});
it.each([
	{ ...creation, ownerId: creation.uniqueId },
	{ ...creation, role: 'ADMIN' },
	{ ...creation, sessionVersion: 0 },
	{ ...creation, lastEdited: Infinity },
	{ ...creation, versionId: -1 },
	{ ...creation, uniqueId: '../private' },
	{ ...creation, config: { title: '', slides: [{ InfoSlide: { title: '', points_awarded: 0 } }] } },
	{
		...creation,
		config: {
			title: '',
			slides: [
				{ TypeAnswer: { title: '', points_awarded: 0, answers: [1], case_sensitive: false } }
			]
		}
	},
	{
		...creation,
		config: {
			title: '',
			slides: [
				{
					Pin: {
						title: '',
						points_awarded: 0,
						correct_area: { Rectangle: { x: 0, y: 0, width: 'x', height: 0 } }
					}
				}
			]
		}
	},
	{
		...creation,
		config: {
			title: '',
			slides: [
				{ InfoSlide: { title: '', media: { Image: { Corkboard: { id: 'public', alt: '' } } } } }
			]
		}
	},
	{ ...creation, config: { title: '', slides: Array(501).fill({ InfoSlide: { title: '' } }) } }
])('rejects malformed or forged private payload %#', (value) => {
	expect(() => validateRecord('creation', value)).toThrow();
});
it('checks actual image bytes rather than accepting a supplied hash or MIME label', () => {
	expect(validateMedia('legacy_image', png).byteSize).toBeGreaterThan(0);
	for (const data of [
		'data:text/html;base64,PHNjcmlwdD4=',
		'data:image/png;base64,PHNjcmlwdD4=',
		'data:image/png;base64,not-valid',
		'https://example.test/image.png'
	]) {
		expect(() => validateMedia('hash', { Image: { Base64: { data, alt: '' } } })).toThrow();
	}
	expect(() =>
		validateMedia('hash', { Image: { Base64: { ...png.Image.Base64, hash: 'other' } } })
	).toThrow();
});
