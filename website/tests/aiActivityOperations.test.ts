import { describe, expect, it } from 'vitest';
import {
	beginActivityOperation,
	cancelActivityOperation,
	finishActivityOperation
} from '../src/lib/ai/activityOperations';

describe('activity generation concurrency', () => {
	it('uses the configured limit and drains running work when the limit decreases', () => {
		const controllers: AbortController[] = [];
		try {
			for (let i = 0; i < 4; i++) {
				const controller = beginActivityOperation(`configured-${i}`, `owner-${i}`, 4);
				expect(controller).toBeDefined();
				if (controller) controllers.push(controller);
			}
			expect(beginActivityOperation('extra', 'extra', 4)).toBeUndefined();
			expect(beginActivityOperation('extra', 'extra', 1)).toBeUndefined();
			expect(controllers.every((controller) => !controller.signal.aborted)).toBe(true);
			for (const controller of controllers) finishActivityOperation(controller);
			for (const limit of [0, -1, NaN, Infinity, 1.5])
				expect(beginActivityOperation('extra', 'extra', limit)).toBeUndefined();
			const next = beginActivityOperation('extra', 'extra', 1);
			expect(next).toBeDefined();
			if (next) controllers.push(next);
			expect(beginActivityOperation('another', 'another', 1)).toBeUndefined();
		} finally {
			for (const controller of controllers) finishActivityOperation(controller);
		}
	});
	it('runs two owners together, bounds the process, and isolates cancellation', () => {
		const first = beginActivityOperation('operation-1', 'owner-1', 2);
		const second = beginActivityOperation('operation-2', 'owner-2', 2);
		try {
			expect(first).toBeDefined();
			expect(second).toBeDefined();
			expect(beginActivityOperation('operation-3', 'owner-3', 2)).toBeUndefined();
			expect(beginActivityOperation('operation-1', 'owner-3', 2)).toBeUndefined();
			expect(cancelActivityOperation('operation-1', 'owner-2')).toBe(false);
			expect(cancelActivityOperation('operation-1', 'owner-1')).toBe(true);
			expect(first?.signal.aborted).toBe(true);
			expect(second?.signal.aborted).toBe(false);
			if (first) finishActivityOperation(first);
			const next = beginActivityOperation('operation-3', 'owner-2', 2);
			expect(next).toBeUndefined();
			const third = beginActivityOperation('operation-3', 'owner-3', 2);
			expect(third).toBeDefined();
			if (third) finishActivityOperation(third);
		} finally {
			if (first) finishActivityOperation(first);
			if (second) finishActivityOperation(second);
		}
	});
});
