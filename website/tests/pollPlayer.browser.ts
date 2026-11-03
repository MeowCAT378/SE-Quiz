// Run with tests/browser.vite.config.ts, then open /tests/pollPlayer.browser.html.
import { mount, tick, unmount } from 'svelte';
import PollAnswers from '../src/lib/question-types/poll/player/Answers.svelte';
import layout from '../src/routes/+layout.svelte?raw';

// Use the application's actual theme without mounting its account/session lifecycle.
const style = document.createElement('style');
style.textContent = (layout.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(
	/:global\(([^)]+)\)/g,
	'$1'
);
document.head.append(style);
const target = document.querySelector<HTMLElement>('#player');
const result = document.querySelector<HTMLOutputElement>('#result');
if (!target || !result) throw new Error('Missing poll test containers');
const answers = ['Design', 'Programming', 'Languages', 'Science', 'Art', 'Music', 'Sport', 'Math'];
const question = 'Which topic would you like to practise?';
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

try {
	for (const count of [2, 5, 8]) {
		for (const showAnswers of [false, true]) {
			const selected: number[] = [];
			const component = mount(PollAnswers, {
				target,
				props: {
					name: 'Poll UI Test',
					score: 0,
					questionText: question,
					media: undefined,
					answers: answers.slice(0, count),
					showAnswers,
					onanswer: (index) => selected.push(index)
				}
			});
			await tick();
			await frame();
			const buttons = [...target.querySelectorAll<HTMLButtonElement>('.answers button')];
			assert(buttons.length === count, 'Every poll option must have a button');
			assert(target.textContent?.includes(question) === showAnswers, 'Question visibility');
			for (const [index, button] of buttons.entries()) {
				const box = button.getBoundingClientRect();
				assert(box.width >= 44 && box.height >= 44, 'Touchable poll options');
				assert(box.left >= 0 && box.right <= innerWidth + 1, 'No horizontal overflow');
				assert(box.bottom <= innerHeight + 1, 'All options fit the viewport');
				assert(button.textContent?.includes(answers[index]) === showAnswers, 'Answer visibility');
				if (!showAnswers) {
					const svg = button.querySelector('svg');
					if (!svg) throw new Error('Missing poll icon');
					const icon = svg.getBoundingClientRect();
					assert(icon.height >= 32 && icon.width >= 32, 'Hidden answers need large icons');
					assert(Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2) < 2, 'Centered icon');
					assert(button.textContent?.trim(), 'Accessible name for icon-only answers');
				}
				button.click();
			}
			assert(
				selected.every((value, index) => value === index),
				'Original option indices'
			);
			await unmount(component);
		}
	}
	result.textContent = 'PASS: 2, 5 and 8 options; hidden/shown answers; layout and selection';
} catch (error) {
	result.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
	throw error;
}

mount(PollAnswers, {
	target,
	props: {
		name: 'Poll UI Test',
		score: 0,
		questionText: question,
		media: undefined,
		answers: answers.slice(0, 5),
		showAnswers: new URL(location.href).searchParams.has('show'),
		onanswer: (index) => {
			result.textContent = `Selected option ${index + 1}: ${answers[index]}`;
		}
	}
});
