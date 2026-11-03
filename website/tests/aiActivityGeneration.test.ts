import { describe, expect, it, vi } from 'vitest';
import {
	type ActivityGenerationRequest,
	generateActivityDrafts,
	validateActivityDrafts,
	validateGenerationRequest
} from '../src/lib/ai/activityGeneration';
import type { BaseAI } from '../src/lib/ai/base';
import type { FuizConfig } from '../src/lib/types';
import { appendActivityDrafts } from '../src/routes/[[lang=locale]]/create/aiActivitySlides';

const base: ActivityGenerationRequest & { language: 'th' } = {
	activityType: 'multiple_choice',
	topic: 'Software Engineering',
	instructions: '',
	itemCount: 5,
	choicesPerItem: 4,
	difficulty: 'mixed',
	language: 'th'
};

describe('activity draft validation', () => {
	it('preserves existing choice-count request compatibility', () => {
		for (const activityType of ['multiple_choice', 'poll']) {
			expect(
				validateGenerationRequest({
					...base,
					activityType,
					difficulty: activityType === 'poll' ? undefined : 'mixed',
					choicesPerItem: '4'
				}).choicesPerItem
			).toBe('4');
		}
	});

	it('accepts integer counts from 1 to 10 only', () => {
		for (const itemCount of [1, 10]) {
			expect(validateGenerationRequest({ ...base, itemCount }).itemCount).toBe(itemCount);
		}
		for (const itemCount of [11, 30, 0, -1, 1.5, '5', null]) {
			expect(() => validateGenerationRequest({ ...base, itemCount })).toThrowError(
				'invalid_request'
			);
		}
	});

	it('accepts each supported type and rejects cross-type fields', () => {
		expect(
			validateActivityDrafts({ ...base, itemCount: 1 }, [
				{ question: 'Q?', choices: ['A', 'B', 'C', 'D'], correctIndex: 1, difficulty: 'medium' }
			])
		).toHaveLength(1);
		expect(
			validateActivityDrafts(
				{ ...base, activityType: 'true_false', itemCount: 1, choicesPerItem: undefined },
				[{ statement: 'Statement', correct: true, difficulty: 'easy' }]
			)
		).toHaveLength(1);
		expect(
			validateActivityDrafts(
				{ ...base, activityType: 'poll', itemCount: 1, difficulty: undefined },
				[{ question: 'Opinion?', choices: ['A', 'B', 'C', 'D'] }]
			)
		).toHaveLength(1);
		expect(
			validateActivityDrafts(
				{
					...base,
					activityType: 'word_cloud',
					itemCount: 1,
					choicesPerItem: undefined,
					difficulty: undefined
				},
				[{ prompt: 'One word for Agile?' }]
			)
		).toHaveLength(1);
		expect(() =>
			validateActivityDrafts(
				{ ...base, activityType: 'poll', itemCount: 1, difficulty: undefined },
				[{ question: 'Opinion?', choices: ['A', 'B', 'C', 'D'], correctIndex: 0 }]
			)
		).toThrowError('invalid_items');
	});

	it('rejects invalid counts, duplicates, and reasoning markers', () => {
		expect(() => validateActivityDrafts({ ...base, itemCount: 2 }, [])).toThrowError(
			'invalid_items'
		);
		expect(() =>
			validateActivityDrafts({ ...base, itemCount: 1, choicesPerItem: 2 }, [
				{ question: 'Q?', choices: ['same', 'Same'], correctIndex: 0, difficulty: 'easy' }
			])
		).toThrowError('invalid_items');
		expect(() =>
			validateActivityDrafts(
				{ ...base, activityType: 'word_cloud', itemCount: 1, choicesPerItem: undefined },
				[{ prompt: '<think>private</think>' }]
			)
		).toThrowError('invalid_items');
	});
});

describe('sequential activity batching', () => {
	it('detects language once, locks later batches, and uses it for true/false answers', async () => {
		const prompts: string[] = [];
		const schemas: unknown[] = [];
		const provider = {
			async generateStructured(input: { userContent: string; schema: any }) {
				prompts.push(input.userContent);
				schemas.push(input.schema);
				const first = prompts.length === 1;
				return {
					content: JSON.stringify({
						...(first ? { language: 'ja', answerLabels: ['正しい', '誤り'] } : {}),
						items: [
							{
								statement: first ? '水は液体です。' : '火は冷たいです。',
								correct: first,
								difficulty: 'medium'
							}
						]
					})
				};
			}
		} as unknown as BaseAI;
		const request = {
			...base,
			activityType: 'true_false' as const,
			choicesPerItem: undefined,
			itemCount: 2,
			difficulty: 'medium' as const,
			language: 'auto' as const,
			fallbackLanguage: 'th' as const,
			instructions: 'ソフトウェアについて日本語で質問を作成する。'
		};
		const { drafts, resolvedLanguage, answerLabels } = await generateActivityDrafts(
			provider,
			request,
			{
				batchSize: 1
			}
		);
		expect(resolvedLanguage).toBe('ja');
		expect(answerLabels).toEqual(['正しい', '誤り']);
		expect(drafts).toHaveLength(2);
		expect((schemas[0] as any).required).toContain('language');
		expect((schemas[1] as any).required).toEqual(['items']);
		expect(prompts[0]).toContain('explicit language request');
		expect(prompts[1]).toContain('Language: ja');
		const config = appendActivityDrafts(
			{ title: 'Activity', slides: [] } as FuizConfig,
			{ ...request, language: resolvedLanguage },
			drafts,
			answerLabels
		);
		const first = config.slides[0];
		if (!('MultipleChoice' in first)) throw new Error('wrong slide type');
		expect(first.MultipleChoice.answers.map((answer) => answer.content.Text)).toEqual([
			'正しい',
			'誤り'
		]);
	});

	it('requires a fallback only in auto mode and rejects invalid detected language', async () => {
		expect(() => validateGenerationRequest({ ...base, language: 'auto' })).toThrowError(
			'invalid_request'
		);
		expect(() => validateGenerationRequest({ ...base, fallbackLanguage: 'en' })).toThrowError(
			'invalid_request'
		);
		const provider = {
			async generateStructured() {
				return { content: JSON.stringify({ language: 'xx', items: [{ prompt: 'Bonjour' }] }) };
			}
		} as unknown as BaseAI;
		await expect(
			generateActivityDrafts(
				provider,
				{
					activityType: 'word_cloud',
					topic: 'Bonjour',
					instructions: '',
					itemCount: 1,
					language: 'auto',
					fallbackLanguage: 'en'
				},
				{ maxAttempts: 1 }
			)
		).rejects.toThrowError('invalid_response');
	});

	it.each([1, 3, 5, 10])('returns exactly %i items in sequential batches', async (itemCount) => {
		let active = 0;
		let maximumActive = 0;
		const calls: number[] = [];
		const provider = {
			async generateStructured(input: { userContent: string }) {
				active++;
				maximumActive = Math.max(maximumActive, active);
				const count = Number(input.userContent.match(/Batch item count: (\d+)/)?.[1]);
				calls.push(count);
				const offset = calls.slice(0, -1).reduce((sum, n) => sum + n, 0);
				const items = Array.from({ length: count }, (_, index) => ({
					question: `Q${offset + index}`,
					choices: ['A', 'B', 'C', 'D'],
					correctIndex: 0,
					difficulty: 'medium'
				}));
				active--;
				return { content: JSON.stringify({ items }), finishReason: 'stop' };
			}
		} as unknown as BaseAI;

		const result = await generateActivityDrafts(provider, {
			...base,
			itemCount,
			difficulty: 'medium'
		});

		expect(result.drafts).toHaveLength(itemCount);
		expect(result.resolvedLanguage).toBe('th');
		expect(calls).toEqual(
			Array.from({ length: Math.ceil(itemCount / 3) }, (_, i) => Math.min(3, itemCount - i * 3))
		);
		expect(maximumActive).toBe(1);
	});

	it('allocates mixed difficulty across the whole request', async () => {
		const seen: string[] = [];
		const provider = {
			async generateStructured(input: { userContent: string }) {
				const difficulty =
					input.userContent.match(/Difficulty plan: ([a-z,]+)/)?.[1]?.split(',') ?? [];
				seen.push(...difficulty);
				return {
					content: JSON.stringify({
						items: difficulty.map((value, index) => ({
							question: `Q${seen.length}-${index}`,
							choices: ['A', 'B', 'C', 'D'],
							correctIndex: 0,
							difficulty: value
						}))
					})
				};
			}
		} as unknown as BaseAI;
		await generateActivityDrafts(provider, { ...base, itemCount: 10 });
		expect(seen).toEqual([
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
	});

	it('retries one invalid batch and rejects generated top-level titles', async () => {
		let calls = 0;
		const provider = {
			async generateStructured() {
				calls++;
				const items = [
					{
						question: 'Q?',
						choices: ['A', 'B', 'C', 'D'],
						correctIndex: 0,
						difficulty: 'medium'
					}
				];
				return {
					content: JSON.stringify(calls === 1 ? { title: 'Do not use', items } : { items })
				};
			}
		} as unknown as BaseAI;

		expect(
			await generateActivityDrafts(provider, { ...base, itemCount: 1, difficulty: 'medium' })
		).toMatchObject({ drafts: [expect.any(Object)], resolvedLanguage: 'th' });
		expect(calls).toBe(2);
	});

	it('logs only sanitized batch metadata', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const provider = {
			async generateStructured() {
				return {
					content: JSON.stringify({
						items: [
							{
								question: 'Private generated question',
								choices: ['A', 'B', 'C', 'D'],
								correctIndex: 0,
								difficulty: 'medium'
							}
						]
					}),
					finishReason: 'stop',
					usage: { promptTokens: 10, completionTokens: 20 }
				};
			}
		} as unknown as BaseAI;

		await generateActivityDrafts(provider, { ...base, itemCount: 1, difficulty: 'medium' });

		expect(info).toHaveBeenCalledWith(
			'AI activity batch completed',
			expect.objectContaining({
				attempt: 1,
				batchSize: 1,
				finishReason: 'stop',
				promptTokens: 10,
				completionTokens: 20
			})
		);
		expect(JSON.stringify(info.mock.calls)).not.toContain('Private generated question');
		info.mockRestore();
	});
});

describe('confirmed draft mapping', () => {
	it('preserves the activity title and existing slide order in one new config', () => {
		const existing = {
			title: 'Keep this title',
			slides: [{ InfoSlide: { title: 'Existing', duration: null }, id: 7 }]
		} as FuizConfig;
		const next = appendActivityDrafts(existing, { ...base, itemCount: 1 }, [
			{
				question: 'Generated?',
				choices: ['A', 'B', 'C', 'D'],
				correctIndex: 2,
				difficulty: 'medium'
			}
		]);
		expect(next).not.toBe(existing);
		expect(next.title).toBe('Keep this title');
		expect(next.slides[0]).toBe(existing.slides[0]);
		expect(next.slides).toHaveLength(2);
		const generated = next.slides[1];
		if (!('MultipleChoice' in generated)) throw new Error('wrong slide type');
		expect(generated.MultipleChoice.answers.filter((answer) => answer.correct)).toHaveLength(1);
		expect(generated.MultipleChoice.answers[2].correct).toBe(true);
		const ids = [generated.id, ...generated.MultipleChoice.answers.map((answer) => answer.id)];
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => id > 7)).toBe(true);
	});

	it('maps true/false, poll, and word cloud to existing slide representations', () => {
		let config = { title: 'Title', slides: [] } as FuizConfig;
		config = appendActivityDrafts(
			config,
			{
				...base,
				activityType: 'true_false',
				itemCount: 1,
				choicesPerItem: undefined,
				language: 'th'
			},
			[{ statement: 'จริงหรือไม่', correct: false, difficulty: 'easy' }]
		);
		config = appendActivityDrafts(
			config,
			{ ...base, activityType: 'poll', itemCount: 1, difficulty: undefined },
			[{ question: 'Pick', choices: ['A', 'B', 'C', 'D'] }]
		);
		config = appendActivityDrafts(
			config,
			{
				...base,
				activityType: 'word_cloud',
				itemCount: 1,
				difficulty: undefined,
				choicesPerItem: undefined
			},
			[{ prompt: 'One word' }]
		);
		expect(config.slides.map((slide) => Object.keys(slide)[0])).toEqual([
			'MultipleChoice',
			'Poll',
			'FreeText'
		]);
		const truth = config.slides[0];
		if (!('MultipleChoice' in truth)) throw new Error('wrong slide type');
		expect(truth.MultipleChoice.answers.map((answer) => answer.content.Text)).toEqual([
			'จริง',
			'เท็จ'
		]);
		expect(truth.MultipleChoice.answers[1].correct).toBe(true);
		const cloud = config.slides[2];
		if (!('FreeText' in cloud)) throw new Error('wrong slide type');
		expect(cloud.FreeText.mode).toBe('WordCloud');
	});

	it('rejects capacity overflow before changing the config', () => {
		const config = {
			title: 'Full',
			slides: Array.from({ length: 500 }, (_, id) => ({
				InfoSlide: { title: '', duration: null },
				id
			}))
		} as FuizConfig;
		expect(() =>
			appendActivityDrafts(config, { ...base, itemCount: 1 }, [
				{ question: 'Q', choices: ['A', 'B', 'C', 'D'], correctIndex: 0, difficulty: 'medium' }
			])
		).toThrowError('slide_capacity');
		expect(config.slides).toHaveLength(500);
	});
});
