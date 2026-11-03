import * as m from '$lib/paraglide/messages.js';
import { locales } from '$lib/paraglide/runtime.js';
import { questionTypes } from '$lib/types';

export type GameStartIssue = 'missing_title' | 'default_title' | 'missing_question';

const defaultTitles = new Set<string>(locales.map((locale) => m.untitled({}, { locale })));
const questionKinds = questionTypes.filter((kind) => kind !== 'InfoSlide');

export function gameStartIssue(config: unknown): GameStartIssue | undefined {
	if (!config || typeof config !== 'object' || Array.isArray(config)) return 'missing_title';
	const value = config as { title?: unknown; slides?: unknown };
	if (typeof value.title !== 'string' || !value.title.trim()) return 'missing_title';
	if (defaultTitles.has(value.title.trim())) return 'default_title';
	if (
		!Array.isArray(value.slides) ||
		!value.slides.some(
			(slide) =>
				slide &&
				typeof slide === 'object' &&
				!Array.isArray(slide) &&
				questionKinds.some((kind) => Object.hasOwn(slide, kind))
		)
	)
		return 'missing_question';
	return undefined;
}
