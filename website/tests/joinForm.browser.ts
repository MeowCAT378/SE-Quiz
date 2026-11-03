import { mount, tick, unmount } from 'svelte';
import JoinForm from '../src/lib/game/JoinForm.svelte';
import * as m from '../src/lib/paraglide/messages.js';
import { completedNavigations } from './browserFramework';

const target = document.querySelector('#test-root') as HTMLElement;
const checks: string[] = [];
function check(value: unknown, message: string) {
	if (!value) throw new Error(message);
	checks.push(message);
}

async function run() {
	for (const inline of [false, true]) {
		let requested = '';
		let calls = 0;
		let respond: (response: Response) => void = () => {};
		window.fetch = (async (url: string) => {
			requested = url;
			calls++;
			return new Promise<Response>((resolve) => {
				respond = resolve;
			});
		}) as typeof fetch;
		const app = mount(JoinForm, { target, props: { inline } });
		await tick();
		const input = target.querySelector('input');
		const form = target.querySelector('form');
		if (!input || !form) throw new Error('Join form did not render');
		const submit = async (code: string) => {
			input.value = code;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await tick();
			form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			await tick();
		};
		const settle = async (response: Response) => {
			respond(response);
			for (let i = 0; i < 100 && input.disabled; i++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			check(!input.disabled, 'request settles and input is usable');
		};
		await submit('   ');
		check(
			calls === 0 && target.textContent?.includes(m.field_required()),
			'blank code stays local'
		);
		await submit('  ab&12  ');
		check(input.disabled && requested.endsWith('/alive/AB%2612'), 'normalized code is encoded');
		form.dispatchEvent(new Event('submit', { cancelable: true }));
		check(calls === 1, 'pending request cannot be submitted twice');
		await settle(new Response('false'));
		check(target.textContent?.includes(m.code_not_exist()), 'missing room shows inline error');
		await submit('12345');
		await settle(new Response('', { status: 503 }));
		check(target.textContent?.includes(m.cannot_connect()), 'unavailable service supports retry');
		await submit('  ab&12  ');
		check(!target.querySelector('[role="alert"]'), 'retry clears the old error');
		await settle(new Response('true'));
		check(
			completedNavigations.at(-1)?.endsWith('/play?code=AB%2612'),
			'valid code navigates safely'
		);
		await unmount(app);
	}
	document.body.dataset.result = 'passed';
	target.textContent = `PASS ${checks.length} checks: ${checks.join('; ')}`;
}

run().catch((error) => {
	document.body.dataset.result = 'failed';
	target.textContent = String(error);
	console.error(error);
});
