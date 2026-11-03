import { beforeEach, describe, expect, it, vi } from 'vitest';

const availability = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/server/llmService', () => ({ activityAvailable: availability }));

import { load as createLoad } from '../src/routes/[[lang=locale]]/create/+page.server';
import { load as editLoad } from '../src/routes/[[lang=locale]]/quiz/[id]/edit/+page.server';

const teacher = {
	id: 'teacher',
	email: 'teacher@example.test',
	role: 'TEACHER' as const,
	createdAt: '2026-09-15T00:00:00Z',
	deletedAt: null,
	sessionVersion: 0
};

beforeEach(() => availability.mockReset().mockResolvedValue(false));

describe('authenticated host page loads', () => {
	it.each([
		createLoad,
		editLoad
	])('accepts teachers without granting system administrator status', async (load) => {
		const result = await load({
			locals: { user: teacher, isAdmin: false },
			url: new URL('http://localhost/th/create')
		} as never);
		expect(result).toEqual(load === editLoad ? { aiAvailable: false } : {});
	});
	it.each([
		createLoad,
		editLoad
	])('redirects anonymous users before exposing private authoring', async (load) => {
		await expect(
			load({
				locals: { user: null, isAdmin: false },
				url: new URL('http://localhost/th/create')
			} as never)
		).rejects.toMatchObject({ status: 303 });
		expect(availability).not.toHaveBeenCalled();
	});
	it('reads current AI availability whenever an authenticated editor is loaded', async () => {
		const event = { locals: { user: teacher }, url: new URL('http://localhost/quiz/1/edit') };
		for (const enabled of [false, true, false]) {
			availability.mockResolvedValue(enabled);
			await expect(editLoad(event as never)).resolves.toEqual({ aiAvailable: enabled });
		}
		expect(availability).toHaveBeenCalledTimes(3);
	});
});
