import { expect, it } from 'vitest';
import { lintConfig, lintConfigIssues } from '../src/lib/question-types/lint';

it('preserves lintConfig priority and locates issues after reorder and deletion', () => {
	const empty = { id: 11, InfoSlide: { title: '' } };
	const missing = { id: 22, MultipleChoice: { title: '', answers: [] } };
	const config = { title: 'Quiz', slides: [empty, missing] } as any;
	expect(lintConfig(config)).toBe('no_answers');
	expect(lintConfigIssues(config)).toEqual([
		{ issue: 'no_answers', slideIndex: 1 },
		{ issue: 'empty_slide', slideIndex: 0 }
	]);
	config.slides.reverse();
	expect(lintConfigIssues(config)[0]).toEqual({ issue: 'no_answers', slideIndex: 0 });
	config.slides.shift();
	expect(lintConfigIssues(config)).toEqual([{ issue: 'empty_slide', slideIndex: 0 }]);
});
