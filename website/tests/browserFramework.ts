export const browser = true;
export const dev = true;
export const assets = '';
export const env = {
	PUBLIC_PLAY_URL: 'http://127.0.0.1:9396',
	PUBLIC_CORKBOARD_URL: 'http://127.0.0.1:9396'
};
export const resolve = (path: string) => path;
export const goto = async (url: string | URL) => {
	completedNavigations.push(String(url));
};
export const page = { url: new URL('http://127.0.0.1:9396'), params: {}, data: {} };

import { onDestroy } from 'svelte';

const navigationGuards = new Set<(event: any) => void>();
export const completedNavigations: string[] = [];
export function beforeNavigate(callback: (event: any) => void) {
	navigationGuards.add(callback);
	onDestroy(() => navigationGuards.delete(callback));
}
export function attemptNavigation(willUnload = false) {
	let cancelled = false;
	for (const guard of navigationGuards)
		guard({
			willUnload,
			type: 'link',
			to: { url: new URL('http://127.0.0.1:9396/create') },
			cancel() {
				cancelled = true;
			}
		});
	return cancelled;
}
