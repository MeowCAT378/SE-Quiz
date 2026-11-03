export type SaveState = 'unsaved' | 'saving' | 'saved' | 'error';
/** Keep one exact uncertain attempt; newer edits wait until it is acknowledged. */
export function createSaveQueue<T, R>(
	prepare: (value: T) => R,
	persist: (value: R) => Promise<void>,
	changed: (state: SaveState, cause?: unknown) => void = () => {}
) {
	let pending: T | undefined;
	let attempt: R | undefined;
	let running: Promise<void> | undefined;
	let failure: unknown;
	async function drain() {
		changed('saving');
		try {
			while (attempt !== undefined || pending !== undefined) {
				if (attempt === undefined) {
					attempt = prepare(pending!);
					pending = undefined;
				}
				await persist(attempt);
				attempt = undefined;
			}
			failure = undefined;
			changed('saved');
		} catch (cause) {
			failure = cause;
			changed('error', cause);
			throw cause;
		}
	}
	return {
		set(value: T) {
			pending = value;
			if ((failure as { status?: number })?.status === 413) {
				attempt = undefined;
				failure = undefined;
			}
			if (!failure) changed('unsaved');
		},
		flush(): Promise<void> {
			if (!running)
				running = drain().finally(() => {
					running = undefined;
				});
			return running;
		}
	};
}
