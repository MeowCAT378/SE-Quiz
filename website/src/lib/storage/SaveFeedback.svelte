<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import { storageErrorMessage } from './feedback';
	import type { SaveState } from './saveQueue';

	let {
		state,
		error,
		warning = false,
		retry
	}: { state: SaveState; error?: unknown; warning?: boolean; retry: () => void } = $props();
</script>
<div class="save-feedback" aria-live="polite" role="status">
	{#if state === 'error'}
		<span>{storageErrorMessage(error)}</span>
		{#if (error as { status?: number })?.status !== 413}<FancyButton onclick={retry}>{m.private_retry()}</FancyButton>{/if}
	{:else if state === 'saving'}{m.private_saving()}
	{:else if state === 'unsaved'}{m.private_unsaved()}
	{:else}{m.private_saved()}{/if}
	{#if warning}<span>{m.private_sync_warning()}</span>{/if}
</div>
<style>.save-feedback { display: flex; flex-wrap: wrap; gap: .5em; padding: .4em .8em; font-size: .8em; align-items: center; }</style>
