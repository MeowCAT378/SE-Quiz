import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('svelte/reactivity', () => ({
	MediaQuery: class {
		current = true;
	}
}));

afterEach(() => vi.unstubAllGlobals());

it('defaults to light on a dark device and preserves explicit choices across reloads', async () => {
	for (const stored of [null, 'dark', 'light', 'invalid']) {
		const values = new Map<string, string>(stored === null ? [] : [['theme', stored]]);
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key)
		});
		const setAttribute = vi.fn();
		vi.stubGlobal('document', { documentElement: { setAttribute, removeAttribute: vi.fn() } });
		vi.resetModules();
		const { theme } = await import('../src/lib/ui/theme.svelte');
		expect(theme.current).toBe(stored === 'dark' ? 'dark' : 'light');
		expect(setAttribute).toHaveBeenLastCalledWith('data-theme', theme.current);

		for (const selected of ['dark', 'light'] as const) {
			theme.current = selected;
			expect(values.get('theme')).toBe(selected);
			expect(setAttribute).toHaveBeenLastCalledWith('data-theme', selected);
			vi.resetModules();
			const reloaded = await import('../src/lib/ui/theme.svelte');
			expect(reloaded.theme.current).toBe(selected);
		}
	}
});
