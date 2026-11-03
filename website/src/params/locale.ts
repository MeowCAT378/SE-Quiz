import type { ParamMatcher } from '@sveltejs/kit';
import { isLocale } from '$lib/paraglide/runtime';

export const match: ParamMatcher = isLocale;
