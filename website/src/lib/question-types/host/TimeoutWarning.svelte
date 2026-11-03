<script lang="ts">
	import { getContext } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import { HOST_CONTROLS, type HostControls } from './types';

	const controls = getContext<HostControls | undefined>(HOST_CONTROLS);
	let remaining = $state(0);
	$effect(() => {
		const timeout = controls?.timeout;
		if (!timeout?.warning) return;
		const received = controls?.receivedAt ?? performance.now();
		const update = () => {
			remaining = Math.max(
				0,
				Math.ceil((timeout.remaining_ms - (performance.now() - received)) / 1000)
			);
		};
		update();
		const interval = setInterval(update, 250);
		return () => clearInterval(interval);
	});
</script>

{#if controls?.timeout?.warning}
	<section class="warning" aria-label={m.host_timeout_title()}>
		<div>
			<strong role="alert">{m.host_timeout_title()}</strong>
			<p>{m.host_timeout_warning()}</p>
			<span role="timer">{m.host_timeout_remaining({ seconds: remaining })}</span>
		</div>
		<FancyButton onclick={() => controls.continueGame()} disabled={controls.continuing || controls.ending}>
			{m.host_continue_game()}
		</FancyButton>
	</section>
{/if}

<style>
	.warning { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.75rem 1rem; background: var(--surface); color: var(--on-surface); border-block-end: 2px solid var(--primary); }
	.warning > div { flex: 1 1 16rem; min-width: 0; overflow-wrap: anywhere; }
	p { margin: 0.25rem 0; }
	[role='timer'] { font-variant-numeric: tabular-nums; }
</style>
