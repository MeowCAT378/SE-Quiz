<script lang="ts">
	import type { Snippet } from 'svelte';
	import { type Palette, paletteClass } from '$lib/clientOnly';

	let {
		palette,
		disabled = false,
		active = true,
		variant = 'primary',
		fill = false,
		type = undefined,
		height = undefined,
		children,
		onclick
	}: {
		palette?: Palette;
		disabled?: boolean;
		active?: boolean;
		variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
		fill?: boolean;
		type?: 'button' | 'submit' | 'reset';
		height?: string;
		children?: Snippet;
		onclick?: () => void;
	} = $props();
</script>

{#snippet body()}
	<div class="back">
		<div class="front">
			{@render children?.()}
		</div>
	</div>
{/snippet}

{#if active}
	<button
		{type}
		class={['root', variant, paletteClass(palette)]}
		class:disabled
		class:fill={fill || height === '100%'}
		style:height={height ?? 'fit-content'}
		disabled={disabled || !active}
		onclick={() => {
			if (onclick) onclick();
		}}
	>
		{@render body()}
	</button>
{:else}
	<div
		class={['root', variant, paletteClass(palette)]}
		class:disabled
		class:fill={fill || height === '100%'}
		style:height={height ?? 'fit-content'}
	>
		{@render body()}
	</div>
{/if}

<style>
	.root {
		display: flex;
		background: none;
		border: none;
		color: inherit;
		box-sizing: border-box;
		padding: 0.2em 0 0;
		width: fit-content;
		min-height: 2.5rem;
		font: inherit;
		outline: none;
		cursor: pointer;
	}

	.root.fill { width: 100%; }

	.root.disabled {
		--btn-bg: #737373;
		--btn-deep: #636363;
		cursor: not-allowed;
	}

	.back {
		background: var(--btn-deep, color-mix(in srgb, var(--primary) 80%, black));
		transition: background 300ms linear;
		border-radius: 0.7em;
		transform: translateY(0);
		width: 100%;
		height: 100%;
	}

	.front {
		background-color: var(--btn-bg, var(--primary));
		border: 0.1em solid var(--btn-deep, color-mix(in srgb, var(--primary) 80%, black));
		border-radius: 0.7em;
		box-sizing: border-box;
		color: var(--btn-fg, #ffffff);
		width: 100%;
		height: 100%;
		transform: translateY(-0.15em);
		transition:
			transform 150ms,
			background-color 300ms linear,
			border-color 300ms linear;
	}

	.root.secondary .front,
	.root.outline .front,
	.root.ghost .front {
		background: var(--surface);
		border-color: var(--outline);
		color: var(--on-surface);
	}

	.root.secondary .back,
	.root.outline .back,
	.root.ghost .back {
		background: var(--outline);
	}

	.root.ghost .front,
	.root.ghost .back { border-color: transparent; background: transparent; }

	.root.danger .front {
		background: #b42318;
		border-color: #8d1c13;
	}

	.root.danger .back { background: #8d1c13; }

	.root:active:not(:disabled) .front {
		transform: translateY(0);
	}

	.root:not(.disabled):where(:global(:hover, :focus-visible)) .front {
		transform: translateY(-0.3em);
	}

	.root:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 45%, transparent); outline-offset: 3px; }
</style>
