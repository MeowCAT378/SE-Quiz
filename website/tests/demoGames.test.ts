import { describe, expect, it } from 'vitest';
import { addIds, fixTimes, removeIds } from '../src/lib/clientOnly';
import { lintConfig } from '../src/lib/question-types/lint';
import { isPinOnTarget } from '../src/lib/question-types/pin/shared/correctness';
import { demoGames, demoPinMedia } from '../src/lib/server/demoGames';
import { validateMedia, validateRecord } from '../src/lib/server/privateValidation';
import { getPointsAwarded, getQuestionType, getTitle, questionTypes } from '../src/lib/types';

describe('demo games', () => {
	it('provides one playable game per picker type and a separate survey', () => {
		expect(demoGames).toHaveLength(15);
		expect(new Set(demoGames.map(({ uniqueId }) => uniqueId)).size).toBe(15);
		expect(new Set(demoGames.map(({ config }) => config.title)).size).toBe(15);
		for (const game of demoGames) {
			expect(validateRecord('creation', game).record).toBe(game);
			expect(lintConfig(addIds(game.config))).toBeUndefined();
			expect(fixTimes(removeIds(addIds(game.config)))).toEqual(game.config);
		}
		const examples = demoGames.slice(0, -1);
		expect(examples.every(({ config }) => config.slides.length === 6)).toBe(true);
		const slides = examples.flatMap(({ config }) => config.slides);
		expect(slides).toHaveLength(84);
		expect([...new Set(slides.map(getQuestionType))].sort()).toEqual([...questionTypes].sort());
		expect(
			examples.map(({ config }) => {
				const kinds = config.slides.map((slide) => {
					if ('MultipleChoice' in slide)
						return slide.MultipleChoice.answers.length === 2 ? 'true-false' : 'quiz';
					if ('Scale' in slide) return slide.Scale.style;
					if ('Pin' in slide) return slide.Pin.correct_area ? 'pin-answer' : 'drop-pin';
					if ('FreeText' in slide) return slide.FreeText.mode;
					return getQuestionType(slide);
				});
				expect(new Set(kinds).size).toBe(1);
				return kinds[0];
			})
		).toEqual([
			'quiz',
			'true-false',
			'TypeAnswer',
			'Slider',
			'pin-answer',
			'Order',
			'Poll',
			'Agreement',
			'Nps',
			'drop-pin',
			'WordCloud',
			'OpenEnded',
			'Brainstorm',
			'InfoSlide'
		]);
		for (const slide of slides) {
			if ('MultipleChoice' in slide)
				expect(slide.MultipleChoice.answers.filter(({ correct }) => correct)).toHaveLength(1);
		}
	});

	it('omits difficulty labels and keeps discussion activities unscored', () => {
		for (const { config } of demoGames)
			for (const slide of config.slides)
				expect(getTitle(slide)).not.toMatch(/^\[(ง่าย|ปานกลาง|ยาก) ·/);
		for (const { config } of demoGames.slice(0, 6)) {
			expect(config.slides.every((slide) => getPointsAwarded(slide) === 1000)).toBe(true);
		}
		for (const { config } of demoGames.slice(6))
			expect(config.slides.every((slide) => getPointsAwarded(slide) === 0)).toBe(true);
		const calculations = demoGames[3].config.slides;
		expect(calculations.map((slide) => 'Slider' in slide && slide.Slider.correct)).toEqual([
			(18 / 20) * 100,
			60 / 20,
			3 * 4,
			0.25 * 80,
			(36 / 40) * 100,
			2 + Math.max(5, 3) + 2
		]);
	});

	it('asks for satisfaction from 1 to 5 and written suggestions without scoring or a deadline', () => {
		const survey = demoGames[demoGames.length - 1];
		expect(survey.config.title).toContain('ความพึงพอใจ');
		expect(survey.config.slides).toEqual([
			{
				Scale: expect.objectContaining({
					min: 1,
					max: 5,
					style: 'Agreement',
					points_awarded: 0,
					time_limit: null,
					labels: { low: '1 = น้อยที่สุด', mid: '3 = ปานกลาง', high: '5 = มากที่สุด' }
				})
			},
			{
				FreeText: expect.objectContaining({
					title: expect.stringContaining('ข้อเสนอแนะ'),
					mode: 'OpenEnded',
					points_awarded: 0,
					time_limit: null,
					max_entries: 1,
					max_entry_length: 200
				})
			}
		]);
	});

	it('provides owned images with targets inside the three architecture boxes', () => {
		const checked = validateMedia(demoPinMedia.hash, demoPinMedia.value);
		expect(checked.mime).toBe('image/svg+xml');
		expect(checked.byteSize).toBeGreaterThan(0);
		const pins = demoGames.flatMap(({ config }) => config.slides).filter((slide) => 'Pin' in slide);
		expect(pins).toHaveLength(12);
		for (const { Pin } of pins) {
			expect(Pin.media?.Image.HashReference.hash).toBe(demoPinMedia.hash);
			if (Pin.correct_area && 'Rectangle' in Pin.correct_area) {
				const { x, y, width, height } = Pin.correct_area.Rectangle;
				expect([0.05, 0.375, 0.7]).toContain(x);
				expect(isPinOnTarget({ x: x + width / 2, y: y + height / 2 }, Pin.correct_area)).toBe(true);
				expect(isPinOnTarget({ x: 0.99, y: 0.99 }, Pin.correct_area)).toBe(false);
			}
		}
	});
});
