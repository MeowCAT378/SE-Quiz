import { expect, it } from 'vitest';
import { gameStartIssue } from '../src/lib/gameStartValidation';
import * as m from '../src/lib/paraglide/messages.js';
import { locales } from '../src/lib/paraglide/runtime.js';
import { questionTypes } from '../src/lib/types';

const question = { MultipleChoice: {} };

it.each(locales)('rejects the default title in locale %s', (locale) => {
	expect(gameStartIssue({ title: `  ${m.untitled({}, { locale })}  `, slides: [question] })).toBe(
		'default_title'
	);
});

it('rejects blank titles, empty activities, and activities with only info slides', () => {
	expect(gameStartIssue({ title: '  ', slides: [question] })).toBe('missing_title');
	expect(gameStartIssue({ title: 'My Quiz', slides: [] })).toBe('missing_question');
	expect(gameStartIssue({ title: 'My Quiz', slides: [{ InfoSlide: {} }] })).toBe(
		'missing_question'
	);
});

it('allows a renamed activity with at least one question', () => {
	expect(gameStartIssue({ title: 'My Quiz', slides: [question] })).toBeUndefined();
});

it.each(
	questionTypes.filter((kind) => kind !== 'InfoSlide')
)('allows %s alongside information slides', (kind) => {
	expect(
		gameStartIssue({ title: 'บทเรียนใหม่', slides: [{ InfoSlide: {} }, { [kind]: {} }] })
	).toBeUndefined();
});

it.each([
	null,
	[],
	{},
	{ title: 123 },
	{ title: 'Quiz', slides: [null, [], {}] }
])('rejects malformed input without throwing: %j', (config) => {
	expect(gameStartIssue(config)).toBeDefined();
});
