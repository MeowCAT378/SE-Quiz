export async function bring(
	input: URL | RequestInfo,
	init?: RequestInit
): Promise<Response | undefined> {
	try {
		return await fetch(input, init);
	} catch {
		return undefined;
	}
}

export function toSorted<T>(array: Array<T>, compare: (a: T, b: T) => number): Array<T> {
	return array.slice().sort(compare);
}

export function zip<T, U>(a: Array<T>, b: Array<U>): Array<[T, U]> {
	if (a.length < b.length) {
		return a.map((v, i) => [v, b[i]]);
	}
	return b.map((v, i) => [a[i], v]);
}

export function isNotUndefined<T>(a?: T): a is T {
	return a !== undefined;
}

export function isNotNull<T>(a: T | null): a is T {
	return a !== null;
}

export function debounce<T>(f: () => T, ms: number) {
	let timer: ReturnType<typeof setTimeout>;
	let pending = false;
	let lastResult: T | undefined;
	const run = () => {
		pending = false;
		lastResult = f();
		return lastResult;
	};
	const debounced = () => {
		pending = true;
		clearTimeout(timer);
		timer = setTimeout(run, ms);
	};
	debounced.flush = () => {
		if (!pending) return lastResult;
		clearTimeout(timer);
		return run();
	};
	return debounced;
}
