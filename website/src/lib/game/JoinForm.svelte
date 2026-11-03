<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import ErrorMessage from '$lib/feedback/ErrorMessage.svelte';
	import LoadingCircle from '$lib/feedback/LoadingCircle.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime.js';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import Textfield from '$lib/ui/Textfield.svelte';
	import { bring } from '$lib/util';

	let { inline = false }: { inline?: boolean } = $props();
	let sending = $state(false);
	let gameCode = $state('');
	let errorMessage = $state('');

	async function submit() {
		if (sending) return;
		const code = gameCode.trim().toUpperCase();
		if (!code) {
			errorMessage = m.field_required();
			return;
		}
		sending = true;
		errorMessage = '';
		try {
			const res = await bring(`${env.PUBLIC_BACKEND_URL}/alive/${encodeURIComponent(code)}`, {
				method: 'GET',
				mode: 'cors'
			});
			if (!res?.ok) {
				errorMessage = m.cannot_connect();
			} else if ((await res.text()) === 'true') {
				await goto(resolve(localizeHref(`/play?code=${encodeURIComponent(code)}`)));
			} else {
				errorMessage = m.code_not_exist();
			}
		} catch {
			errorMessage = m.cannot_connect();
		} finally {
			sending = false;
		}
	}
</script>

<form
	class:inline
	aria-label={m.play()}
	aria-busy={sending}
	onsubmit={(event) => {
		event.preventDefault();
		void submit();
	}}
>
	<div class="code-field">
		<Textfield
			id="code"
			placeholder={m.game_code()}
			required={true}
			disabled={sending}
			showInvalid={false}
			bind:value={gameCode}
			textTransform="uppercase"
			inputmode="numeric"
			ariaDescribedby={errorMessage ? 'join-error' : undefined}
		/>
	</div>
	<div class="join-action">
		<FancyButton type="submit" fill disabled={sending}>
			<div class="cta">
				{#if sending}<span class="spinner"><LoadingCircle /></span>{/if}
				{m.join()}
			</div>
		</FancyButton>
	</div>
	{#if errorMessage}
		<div id="join-error" class="error"><ErrorMessage {errorMessage} /></div>
	{/if}
</form>

<style>
	form {
		display: grid;
		gap: 0.85em;
		width: 100%;
	}

	.code-field { min-width: 0; }

	.join-action {
		justify-self: center;
		width: 9rem;
		max-width: 100%;
		align-self: end;
	}

	.cta {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 1.8em;
		font-family: var(--alternative-font);
	}

	.spinner { height: 1em; aspect-ratio: 1 / 1; margin-inline-end: 0.4em; }
	.error { grid-column: 1 / -1; }

	.inline {
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.65em;
	}

	.inline .join-action { width: auto; min-width: 5.5em; }

	@media (max-width: 400px) {
		.inline { grid-template-columns: minmax(0, 1fr); }
		.inline .join-action { width: 100%; }
	}
</style>
