import { describe, expect, it } from 'vitest';
import {
	type ActivityGenerationRequest,
	type ActivityType,
	type GeneratedActivityDraft,
	generateActivityDrafts,
	validateActivityDrafts,
	validateGenerationRequest
} from '../src/lib/ai/activityGeneration';
import type { StructuredGenerationRequest } from '../src/lib/ai/base';
import type { Base64Media, GenericFuizConfig } from '../src/lib/types';
import { appendActivityDrafts } from '../src/routes/[[lang=locale]]/create/aiActivitySlides';

// Literal examples are independent of the production schemas and templates.
const cases = [
	[
		'multiple_choice',
		{
			question: 'Pick a primary color',
			choices: ['Red', 'Green'],
			correctIndex: 0,
			difficulty: 'medium'
		},
		'MultipleChoice'
	],
	[
		'true_false',
		{ statement: 'Water is a liquid', correct: true, difficulty: 'medium' },
		'MultipleChoice'
	],
	['poll', { question: 'Choose a color', choices: ['Red', 'Blue'] }, 'Poll'],
	['word_cloud', { prompt: 'Describe today in one word' }, 'FreeText'],
	[
		'short_answer',
		{ question: 'Name the planet we live on', answers: ['Earth', 'โลก'], difficulty: 'medium' },
		'TypeAnswer'
	],
	[
		'slider',
		{
			question: 'What is half of 100?',
			range: { min: 0, max: 100, step: 2 },
			correct: 50,
			tolerance: 0,
			unit: '%',
			difficulty: 'medium'
		},
		'Slider'
	],
	[
		'ordering',
		{
			question: 'Order these numbers from smallest to largest',
			items: ['One', 'Two', 'Three'],
			difficulty: 'medium'
		},
		'Order'
	],
	[
		'agreement_scale',
		{
			question: 'How useful was this lesson?',
			labels: { low: 'Not useful', mid: 'Neutral', high: 'Very useful' }
		},
		'Scale'
	],
	[
		'nps',
		{
			question: 'Would you recommend this lesson?',
			labels: { low: 'Not likely', mid: 'Neutral', high: 'Very likely' }
		},
		'Scale'
	],
	['open_ended', { prompt: 'Explain what you learned' }, 'FreeText'],
	['brainstorm', { prompt: 'Suggest ways to save energy' }, 'Brainstorm'],
	['pin_answer', { question: 'Locate the heart on a diagram', difficulty: 'medium' }, 'Pin'],
	['drop_pin', { question: 'Mark your favorite place on a map' }, 'Pin']
] as const;

function requestFor(type: string, itemCount = 1): ActivityGenerationRequest & { language: 'en' } {
	return {
		activityType: type as ActivityType,
		topic: 'Classroom learning',
		instructions: '',
		itemCount,
		language: 'en',
		...([
			'multiple_choice',
			'true_false',
			'short_answer',
			'slider',
			'ordering',
			'pin_answer'
		].includes(type)
			? { difficulty: 'mixed' as const }
			: {}),
		...(['multiple_choice', 'poll'].includes(type) ? { choicesPerItem: 2 as const } : {})
	};
}

const image: Base64Media = {
	Image: {
		Base64: {
			data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
			alt: 'A synthetic image'
		}
	}
};
const attachment = {
	media: image,
	correctArea: { Rectangle: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 } }
};

describe('all AI activity templates', () => {
	it.each(cases)('validates and generates %s at both count boundaries', async (type, sample) => {
		for (const count of [1, 10]) {
			const request = requestFor(type, count);
			expect(validateGenerationRequest(request)).toEqual(request);
			let offset = 0;
			const provider = {
				async generateStructured(input: StructuredGenerationRequest) {
					const schema = input.schema as {
						properties: {
							items: {
								minItems: number;
								items: {
									properties: Record<string, unknown>;
									required: string[];
									additionalProperties: boolean;
								};
							};
						};
					};
					const batch = schema.properties.items;
					expect(batch.items.required.slice().sort()).toEqual(Object.keys(sample).sort());
					expect(batch.items.additionalProperties).toBe(false);
					expect(batch.items.properties).not.toHaveProperty('media');
					const plan = input.userContent.match(/Difficulty plan: ([a-z,]+)/)?.[1].split(',');
					const textKey =
						'question' in sample ? 'question' : 'statement' in sample ? 'statement' : 'prompt';
					const items = Array.from({ length: batch.minItems }, (_, index) => ({
						...sample,
						[textKey]: `${sample[textKey as keyof typeof sample]} ${++offset}`,
						...(plan ? { difficulty: plan[index] } : {})
					}));
					return { content: JSON.stringify({ items }) };
				}
			};
			const result = await generateActivityDrafts(provider, request);
			expect(result.drafts).toHaveLength(count);
			expect(result.resolvedLanguage).toBe('en');
			if ('difficulty' in sample && count === 10) {
				expect(result.drafts.map((draft) => 'difficulty' in draft && draft.difficulty)).toEqual([
					'easy',
					'easy',
					'easy',
					'medium',
					'medium',
					'medium',
					'medium',
					'hard',
					'hard',
					'hard'
				]);
			}
		}
	});

	it.each(cases)('rejects invalid counts and extra draft fields for %s', (type, sample) => {
		for (const count of [11, 30, 0, -1, 1.5]) {
			expect(() => validateGenerationRequest(requestFor(type, count))).toThrowError(
				'invalid_request'
			);
		}
		expect(() =>
			validateActivityDrafts(requestFor(type), [{ ...sample, media: image }])
		).toThrowError('invalid_items');
		expect(() => validateActivityDrafts(requestFor(type, 2), [sample, sample])).toThrowError(
			'duplicate_items'
		);
	});

	it.each(cases)('converts %s through existing templates', (type, sample, wireType) => {
		const config: GenericFuizConfig<Base64Media | undefined> = {
			title: 'Keep title',
			slides: [{ id: 91, InfoSlide: { title: 'Keep content', duration: null } }]
		};
		const next = appendActivityDrafts(
			config,
			requestFor(type),
			[structuredClone(sample) as GeneratedActivityDraft],
			undefined,
			[attachment]
		);
		expect(next.title).toBe('Keep title');
		expect(config.slides).toHaveLength(1);
		expect(next.slides[0]).toBe(config.slides[0]);
		const slide = next.slides[1];
		expect(slide).toHaveProperty(wireType);
		expect(slide.id).toBeGreaterThan(91);
		if ('TypeAnswer' in slide)
			expect(slide.TypeAnswer).toMatchObject({
				case_sensitive: false,
				time_limit: 60000,
				points_awarded: 1000,
				answers: [{ text: 'Earth' }, { text: 'โลก' }]
			});
		if ('Order' in slide)
			expect(slide.Order.answers.map((answer) => answer.text)).toEqual(['One', 'Two', 'Three']);
		if ('Slider' in slide)
			expect(slide.Slider).toMatchObject({
				range: { min: 0, max: 100, step: 2 },
				correct: 50,
				tolerance: 0,
				unit: '%',
				points_awarded: 1000
			});
		if ('Scale' in slide)
			expect(slide.Scale).toMatchObject(
				type === 'nps'
					? { min: 0, max: 10, style: 'Nps', points_awarded: 0 }
					: { min: 1, max: 5, style: 'Agreement', points_awarded: 0 }
			);
		if ('FreeText' in slide)
			expect(slide.FreeText).toMatchObject(
				type === 'word_cloud'
					? { mode: 'WordCloud', max_entries: 3, max_entry_length: 40 }
					: { mode: 'OpenEnded', max_entries: 1, max_entry_length: 200 }
			);
		if ('Brainstorm' in slide)
			expect(slide.Brainstorm).toMatchObject({
				max_ideas_per_player: 3,
				max_votes_per_player: 3,
				max_idea_length: 200,
				idea_time_limit: 120000,
				vote_time_limit: 60000,
				points_awarded: 0
			});
		if ('Pin' in slide)
			expect(slide.Pin).toMatchObject({
				media: image,
				points_awarded: type === 'pin_answer' ? 1000 : 0,
				correct_area: type === 'pin_answer' ? attachment.correctArea : null
			});
	});

	it('rejects InfoSlide at both request and draft boundaries', () => {
		for (const type of ['InfoSlide', 'info_slide', 'info-slide', 'unknown']) {
			expect(() => validateGenerationRequest(requestFor(type))).toThrowError('invalid_request');
			expect(() => validateActivityDrafts(requestFor(type), [{ prompt: 'Text' }])).toThrowError(
				'invalid_items'
			);
		}
	});
});

describe('answer and numeric limits', () => {
	it.each([
		'short_answer',
		'ordering'
	])('rejects empty, repeated and excessive %s answers', (type) => {
		const key = type === 'short_answer' ? 'answers' : 'items';
		for (const answers of [
			[],
			[''],
			['A', ' a '],
			['a'.repeat(501), 'B'],
			Array.from({ length: type === 'short_answer' ? 17 : 9 }, (_, i) => String(i))
		]) {
			expect(() =>
				validateActivityDrafts(requestFor(type), [
					{ question: 'Question', [key]: answers, difficulty: 'medium' }
				])
			).toThrowError('invalid_items');
		}
	});
	it('requires at least two ordered items', () => {
		expect(() =>
			validateActivityDrafts(requestFor('ordering'), [
				{ question: 'Order', items: ['one'], difficulty: 'medium' }
			])
		).toThrowError('invalid_items');
	});
	it('rejects broken slider ranges and unreachable correct values', () => {
		const sample = {
			question: 'Estimate',
			range: { min: 0, max: 7, step: 2 },
			correct: 6,
			tolerance: 0,
			unit: '',
			difficulty: 'medium'
		};
		const check = (changes: Record<string, unknown>) =>
			validateActivityDrafts(requestFor('slider'), [{ ...sample, ...changes }]);
		expect(check({})).toHaveLength(1);
		expect(check({ correct: 7, tolerance: 1 })).toHaveLength(1);
		expect(check({ range: { min: 0, max: 1, step: 0.1 }, correct: 0.3 })).toHaveLength(1);
		for (const changes of [
			{ range: { min: 1, max: 1, step: 1 } },
			{ range: { min: 2, max: 1, step: 1 } },
			{ range: { min: 0, max: 7, step: 0 } },
			{ range: { min: 0, max: 7, step: -1 } },
			{ range: { min: 0, max: 10000, step: 1 } },
			{ range: { min: 0, max: 7, step: Infinity } },
			{ range: { min: -1e308, max: 1e308, step: 1 } },
			{ correct: 7 },
			{ correct: 0.5 },
			{ correct: -1 },
			{ correct: NaN },
			{ tolerance: -1 },
			{ tolerance: Infinity },
			{ unit: 'x'.repeat(21) }
		])
			expect(() => check(changes)).toThrowError('invalid_items');
	});
	it.each(['agreement_scale', 'nps'])('rejects empty and oversized %s labels', (type) => {
		for (const low of ['', ' ', 'x'.repeat(251)]) {
			expect(() =>
				validateActivityDrafts(requestFor(type), [
					{ question: 'Rate', labels: { low, mid: 'Neutral', high: 'High' } }
				])
			).toThrowError('invalid_items');
		}
	});
});

describe('reviewed attachments and IDs', () => {
	it('rejects slider numbers that private storage cannot persist', () => {
		const sample = {
			question: 'Measure',
			range: { min: 0, max: 100, step: 1 },
			correct: 50,
			tolerance: 1,
			unit: '',
			difficulty: 'medium'
		};
		const large = Number.MAX_SAFE_INTEGER + 1;
		for (const draft of [
			{ ...sample, range: { min: -large, max: 0, step: large }, correct: 0 },
			{ ...sample, range: { min: 0, max: large, step: 1e13 }, correct: 0 },
			{ ...sample, range: { min: 0, max: 100, step: large }, correct: 0 },
			{ ...sample, tolerance: large },
			{ ...sample, range: { min: 0, max: 1e25, step: 1e24 }, correct: 6e24, tolerance: 1e23 }
		])
			expect(() => validateActivityDrafts(requestFor('slider'), [draft])).toThrowError(
				'invalid_items'
			);
	});
	it('allocates IDs above existing Short Answer and Ordering answer IDs', () => {
		const config: GenericFuizConfig<Base64Media | undefined> = {
			title: '',
			slides: [
				{
					id: 1,
					TypeAnswer: {
						title: 'Q',
						answers: [{ id: 800, text: 'A' }],
						points_awarded: 1000,
						case_sensitive: false
					}
				},
				{
					id: 2,
					Order: {
						title: 'Q',
						answers: [{ id: 900, text: 'A' }],
						axis_labels: {},
						points_awarded: 1000
					}
				}
			]
		};
		const next = appendActivityDrafts(config, requestFor('short_answer'), [
			{ question: 'Q2', answers: ['A', 'B'], difficulty: 'medium' } as GeneratedActivityDraft
		]);
		const slide = next.slides[2];
		if (!('TypeAnswer' in slide)) throw new Error('wrong slide');
		expect([slide.id, ...slide.TypeAnswer.answers.map((answer) => answer.id)]).toEqual([
			901, 902, 903
		]);
	});
	it('requires teacher images and bounded, nonempty rectangular targets', () => {
		const config: GenericFuizConfig<Base64Media | undefined> = { title: '', slides: [] };
		const draft = { question: 'Locate', difficulty: 'medium' } as GeneratedActivityDraft;
		for (const invalid of [
			undefined,
			{},
			{ media: image },
			{ ...attachment, media: undefined },
			{ ...attachment, media: { Image: { Base64: { data: '', alt: '' } } } },
			...[
				{ x: 0.1, y: 0.1, width: 0, height: 0.2 },
				{ x: 0.9, y: 0.1, width: 0.2, height: 0.2 },
				{ x: -0.1, y: 0, width: 0.2, height: 0.2 },
				{ x: 0, y: 0, width: NaN, height: 0.2 }
			].map((Rectangle) => ({ media: image, correctArea: { Rectangle } }))
		]) {
			expect(() =>
				appendActivityDrafts(
					config,
					requestFor('pin_answer'),
					[draft],
					undefined,
					invalid ? [invalid] : undefined
				)
			).toThrow();
		}
		expect(config.slides).toHaveLength(0);
		expect(() =>
			appendActivityDrafts(config, requestFor('drop_pin'), [
				{ question: 'Place' } as GeneratedActivityDraft
			])
		).toThrow();
	});
});
