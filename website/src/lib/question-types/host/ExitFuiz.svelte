<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { HOST_CONTROLS, type HostControls } from './types';

	let exitDialog = $state<ConfirmationDialog>();
	const controls = getContext<HostControls | undefined>(HOST_CONTROLS);
	onMount(() => {
		if (controls?.consumeEndRequest()) exitDialog?.open();
	});
</script>

{#if controls}
<button class="exit-fuiz" disabled={controls.ending} onclick={() => exitDialog?.open()}>
	{m.host_end_game()}
</button>

<ConfirmationDialog
	bind:this={exitDialog}
	title={m.host_end_game()}
	message={m.host_end_confirm()}
	confirmText={m.host_end_game()}
	onConfirm={() => controls.end()}
/>
{/if}

<style>
	.exit-fuiz {
		cursor: pointer;
		appearance: none;
		display: flex;
		padding: 0.3em 0.4em;
		gap: 2px;
		align-items: center;
		line-height: 1em;
		font-size: inherit;
		font-family: var(--alternative-font);
		background: var(--on-surface);
		color: var(--surface);
		border: none;
		border-radius: 100px;
	}
	.exit-fuiz:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; }
	.exit-fuiz:disabled { opacity: 0.6; cursor: wait; }
</style>
