<script lang="ts">
	import NiceBackground from '$lib/layout/NiceBackground.svelte';
	import TimeoutWarning from './TimeoutWarning.svelte';
	import Topbar from './Topbar.svelte';
	import type { BindableGameInfo, ResponseSummary, SharedGameInfo } from './types';

	let {
		bindableGameInfo = $bindable(),
		gameInfo,
		onlock,
		onnext,
		responses = undefined,
		textForward = false,
		extraControls,
		children
	}: {
		bindableGameInfo: BindableGameInfo;
		gameInfo: SharedGameInfo;
		onlock?: (locked: boolean) => void;
		onnext?: () => void;
		responses?: ResponseSummary;
		textForward?: boolean;
		extraControls?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	} = $props();

	let fullscreenElement = $state<HTMLElement>();
</script>

<div bind:this={fullscreenElement} class="root">
	<TimeoutWarning />
	<Topbar
		bind:bindableGameInfo
		{gameInfo}
		{fullscreenElement}
		{onlock}
		{onnext}
		{responses}
		{extraControls}
	/>
	<div class="background-area">
		<NiceBackground>
			<div class="layout" class:no-media={textForward}>
				{@render children()}
			</div>
		</NiceBackground>
	</div>
</div>

<style>
	.root {
		height: 100dvh;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.background-area {
		flex: 1;
		min-height: 0;
	}

	.layout {
		--host-question-max-height: 32dvh;
		--host-min-width: 0;
		--host-icon-shrink: 0;
		--host-text-overflow: auto;
		--host-answer-columns: minmax(0, 1fr) minmax(0, 1fr);
		--host-response-min: min(100%, 14em);
		--host-cloud-align: safe center;
		min-width: 0;
		min-height: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.no-media {
		--host-question-size: clamp(1.75rem, min(4.5vw, 7vh), 4.5rem);
		--host-answer-size: clamp(1.25rem, min(3.7vw, 5.5vh), 3rem);
		--host-label-size: var(--host-answer-size);
		--host-cloud-base: clamp(1.25rem, 2.5vw, 1.75rem);
		--host-content-gap: clamp(0.6rem, 1.5vmin, 1.5rem);
		--host-answer-align: stretch;
		--host-answer-rows: minmax(min-content, 1fr);
		--host-answer-height: 100%;
		--host-text-line-height: 1.5;
	}
</style>
