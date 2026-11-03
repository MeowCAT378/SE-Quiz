import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

let current = $state<Theme>('light');

if (browser) {
	const stored = localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
	current = stored;
	document.documentElement.setAttribute('data-theme', stored);
}

export const theme = {
	get current(): Theme {
		return current;
	},
	set current(next: Theme) {
		current = next;
		localStorage.setItem('theme', next);
		document.documentElement.setAttribute('data-theme', next);
	}
};
