<script lang="ts">
	import { resolve } from '$app/paths';
	import ErrorMessage from '$lib/feedback/ErrorMessage.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { clearAccountStorage } from '$lib/storage/account';
	import FancyAnchorButton from '$lib/ui/FancyAnchorButton.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';

	let { form } = $props();
</script>
<svelte:head><title>{m.log_out()}</title></svelte:head>
<TypicalPage><main>
	<h1>{m.log_out()}</h1>
	{#if form?.unavailable}<ErrorMessage errorMessage={m.logout_unconfirmed()} />{:else}
		<p>{m.logout_confirmation()}</p><form method="POST" onsubmit={() => { clearAccountStorage(); localStorage.setItem('seopen-session-change', String(Date.now())); }}><FancyButton type="submit">{m.log_out()}</FancyButton></form>
	{/if}
	<FancyAnchorButton href={resolve(localizeHref('/'))}>{m.back_home()}</FancyAnchorButton>
</main></TypicalPage>
<style>main { max-width: 35em; margin: 2em auto; padding: 1em; display: flex; flex-direction: column; gap: 1em; }</style>
