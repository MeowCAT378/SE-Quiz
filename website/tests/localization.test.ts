import { describe, expect, it } from 'vitest';
import { getLocales, getTranslations, isNonTrivialText } from '../scripts/message-utils.js';

describe('localization coverage', () => {
	it('detects short and non-Latin UI text, but not punctuation or numbers', () => {
		for (const text of ['To', 'ข้อ', 'เข้าสู่ระบบ', '中文', 'العربية']) {
			expect(isNonTrivialText(text)).toBe(true);
		}
		for (const text of ['', '  ', '123', '×', '••••••••', '50%']) {
			expect(isNonTrivialText(text)).toBe(false);
		}
	});

	it('keeps Thai complete and preserves interpolation parameters in every locale', () => {
		const english = getTranslations();
		expect(getLocales()).toContain('th');
		for (const locale of getLocales()) {
			const messages = getTranslations(locale);
			expect(Object.keys(messages)).toEqual(Object.keys(english));
			for (const [key, value] of Object.entries(english)) {
				const parameters = (text: string) =>
					[...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
				expect(parameters(messages[key]), `${locale}.${key}`).toEqual(parameters(value));
			}
		}
		for (const [key, value] of Object.entries(getTranslations('th'))) {
			if (!['brand_name', 'nps_score', 'word_cloud'].includes(key))
				expect(value, key).toMatch(/\p{Script=Thai}/u);
		}
	});

	it('keeps account messages friendly and uses the Word Cloud product term', () => {
		const english = getTranslations('en');
		const thai = getTranslations('th');
		expect(english.password_policy).toBe(
			'Leave blank to keep the current password. Use at least 12 characters.'
		);
		expect(english.password_too_long).toBe('The password is too long.');
		expect(thai.password_too_long).toBe('รหัสผ่านยาวเกินไป');
		expect(Object.values(english).join(' ')).not.toContain('1024 UTF-8 bytes');
		expect(Object.values(thai).join(' ')).not.toContain('เมฆคำ');
		expect(thai.word_cloud).toBe('Word Cloud');
	});

	it('localizes the AI item limit with its interpolation parameter', () => {
		expect(getTranslations('en').ai_item_count_max).toBe('Up to {count} questions at once.');
		expect(getTranslations('th').ai_item_count_max).toBe('สูงสุด {count} ข้อต่อครั้ง');
	});

	it('uses SE Quiz consistently as the user-facing product name', () => {
		for (const locale of getLocales()) {
			const messages = getTranslations(locale);
			expect(messages.brand_name, locale).toBe('SE Quiz');
			expect(messages.main_title, locale).toContain('SE Quiz');
			expect(messages.logo_alt, locale).toContain('SE Quiz');
			expect(Object.values(messages).join(' '), locale).not.toMatch(/SE\s?Open|Fuiz|فويز|协习/);
		}
	});
});
