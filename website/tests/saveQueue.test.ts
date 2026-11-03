import { expect, it, vi } from 'vitest';
import { createSaveQueue } from '../src/lib/storage/saveQueue';

it('serializes rapid edits, builds versions after ACK, and flush waits for the final save', async () => {
	let version = 0;
	let release!: () => void;
	const writes: { text: string; version: number }[] = [];
	const queue = createSaveQueue(
		(text: string) => ({ text, version: version + 1 }),
		async (candidate) => {
			writes.push(candidate);
			if (writes.length === 1)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			version = candidate.version;
		}
	);
	queue.set('first');
	const saving = queue.flush();
	queue.set('last');
	expect(version).toBe(0);
	expect(writes).toEqual([{ text: 'first', version: 1 }]);
	release();
	await saving;
	expect(writes).toEqual([
		{ text: 'first', version: 1 },
		{ text: 'last', version: 2 }
	]);
	expect(version).toBe(2);
});
it('retains the exact uncertain attempt for manual retry instead of replacing its timestamp/body', async () => {
	let counter = 0;
	let fail = true;
	const writes: unknown[] = [];
	const queue = createSaveQueue(
		(text: string) => ({ text, stamp: ++counter }),
		async (value) => {
			writes.push(value);
			if (fail) throw { status: 503 };
		}
	);
	queue.set('unsaved');
	await expect(queue.flush()).rejects.toMatchObject({ status: 503 });
	fail = false;
	await queue.flush();
	expect(writes).toEqual([
		{ text: 'unsaved', stamp: 1 },
		{ text: 'unsaved', stamp: 1 }
	]);
});
it('does not loop a permanent 413 and accepts a smaller replacement draft', async () => {
	vi.useFakeTimers();
	const writes: string[] = [];
	const queue = createSaveQueue(
		(text: string) => text,
		async (value) => {
			writes.push(value);
			if (value === 'large') throw { status: 413 };
		}
	);
	queue.set('large');
	await expect(queue.flush()).rejects.toMatchObject({ status: 413 });
	await vi.advanceTimersByTimeAsync(10000);
	expect(writes).toEqual(['large']);
	queue.set('small');
	await queue.flush();
	expect(writes).toEqual(['large', 'small']);
	vi.useRealTimers();
});
