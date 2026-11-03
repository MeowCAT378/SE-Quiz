import { expect, it } from 'vitest';
import { matchesListFilters, parseListDate, reversedDates } from '../src/lib/listFilters';

it('parses day/month/year input and rejects impossible or ambiguous dates', () => {
	expect(parseListDate(' 2/10/2026 ')).toBe('2026-10-02');
	expect(parseListDate('29/02/2024')).toBe('2024-02-29');
	expect(parseListDate('01/01/0099')).toBe('0099-01-01');
	expect(parseListDate('')).toBe('');
	for (const value of [
		'29/02/2026',
		'31/04/2026',
		'00/10/2026',
		'10/13/2026',
		'01/01/0000',
		'2/10/26',
		'2026-10-02',
		'abc'
	]) {
		expect(parseListDate(value), value).toBeNull();
		expect(matchesListFilters('Quiz', Date.now(), '', value, '')).toBe(false);
		expect(matchesListFilters('Quiz', Date.now(), '', '', value)).toBe(false);
	}
});

it('matches trimmed English and Thai titles without changing their order', () => {
	const titles = ['English Quiz', 'แบบทดสอบ ภาษาไทย', 'Other'];
	expect(titles.filter((title) => matchesListFilters(title, 0, ' ENGLISH ', '', ''))).toEqual([
		'English Quiz'
	]);
	expect(titles.filter((title) => matchesListFilters(title, 0, ' ภาษาไทย ', '', ''))).toEqual([
		'แบบทดสอบ ภาษาไทย'
	]);
	expect(titles.filter((title) => matchesListFilters(title, 0, '  ', '', ''))).toEqual(titles);
});

it('combines title and local calendar dates including the entire final day', () => {
	expect(
		matchesListFilters(
			'Quiz',
			new Date(2026, 8, 19, 23, 59, 59, 999).getTime(),
			'quiz',
			'18/09/2026',
			'19/09/2026'
		)
	).toBe(true);
	expect(
		matchesListFilters('Quiz', new Date(2026, 8, 20).getTime(), 'quiz', '', '19/09/2026')
	).toBe(false);
	expect(
		matchesListFilters('Other', new Date(2026, 8, 19).getTime(), 'quiz', '', '19/09/2026')
	).toBe(false);
});

it('rejects reversed ranges without silently swapping them', () => {
	expect(reversedDates('20/09/2026', '19/09/2026')).toBe(true);
	expect(reversedDates('30/09/2026', '01/10/2026')).toBe(false);
	expect(
		matchesListFilters('Quiz', new Date(2026, 8, 19).getTime(), '', '20/09/2026', '19/09/2026')
	).toBe(false);
});
