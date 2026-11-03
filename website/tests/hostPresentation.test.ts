import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/host/12345') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), beforeNavigate: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import TextAnswerButton from '../src/lib/game/TextAnswerButton.svelte';
import TextBar from '../src/lib/game/TextBar.svelte';
import HostLayout from '../src/lib/question-types/host/HostLayout.svelte';
import Answers from '../src/lib/question-types/mcq/host/Answers.svelte';
import Statistics from '../src/lib/question-types/mcq/host/Statistics.svelte';

const shared = {
	bindableGameInfo: { volumeOn: false, locked: false },
	gameInfo: { gameCode: '12345', questionIndex: 0, questionTotalCount: 1 },
	questionText: 'A readable question',
	timeLeft: null,
	timeStarted: null,
	answeredCount: 0
};

it('preserves default HostLayout and shared Player/editor primitive calls', () => {
	const output = render(HostLayout, {
		props: {
			bindableGameInfo: shared.bindableGameInfo,
			gameInfo: shared.gameInfo,
			children: createRawSnippet(() => ({ render: () => '<div>Existing content</div>' }))
		}
	});
	expect(output.body).not.toContain('no-media');
	expect(output.body).toContain('Existing content');
	for (const output of [
		render(TextBar, { props: { text: 'Shared question' } }),
		render(TextAnswerButton, {
			props: { index: 0, answerText: 'Shared answer', correct: undefined }
		})
	]) {
		expect(output.body).not.toContain('no-media');
		expect(output.body).not.toContain('--host-');
	}
});

it('limits Host question text without changing the shared default', () => {
	const normal = render(TextBar, { props: { text: 'Question' } }).body;
	const host = render(TextBar, { props: { text: 'Question', maxLines: 3 } }).body;
	expect(normal).not.toContain('limited');
	expect(host).toContain('limited');
	expect(host).toContain('--max-lines: 3');
});

it.each([
	undefined,
	{ Image: { Corkboard: { id: 'test', alt: 'Test image' } } }
])('selects the Host presentation from media presence: %j', (media) => {
	const active = render(Answers, { props: { ...shared, media, answers: ['Yes', 'No'] } });
	const results = render(Statistics, {
		props: {
			bindableGameInfo: shared.bindableGameInfo,
			gameInfo: shared.gameInfo,
			questionText: shared.questionText,
			media,
			answers: [{ text: 'Yes', count: 1, correct: true }]
		}
	});
	for (const output of [active, results]) {
		expect(output.body.includes('no-media')).toBe(media === undefined);
		expect(output.body).toContain(shared.questionText);
		expect(output.body).toContain('topbar');
	}
});
