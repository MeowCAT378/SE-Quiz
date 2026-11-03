import { afterEach, expect, it, vi } from 'vitest';

import { debounce } from '$lib/util';

afterEach(() => {
	vi.useRealTimers();
});

it('flushes pending work once and returns its result', () => {
	vi.useFakeTimers();
	const work = vi.fn(() => 'saved');
	const pending = debounce(work, 500);

	pending();
	expect(work).not.toHaveBeenCalled();
	expect(pending.flush()).toBe('saved');

	vi.advanceTimersByTime(500);
	expect(work).toHaveBeenCalledTimes(1);
});
