<script lang="ts">
	import type { Snippet } from 'svelte';
	import { type Palette, paletteClass } from '$lib/clientOnly';

	let {
		palette,
		variant = 'primary',
		fill = false,
		href,
		children,
		download
	}: {
		palette?: Palette;
		variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
		fill?: boolean;
		href: string;
		children?: Snippet;
		download?: unknown;
	} = $props();
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a {href} {download} class={['root', variant, paletteClass(palette)]} class:fill>
	<div class="back">
		<div class="front">
			{@render children?.()}
		</div>
	</div>
</a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.root {
		display: flex;
		background: none;
		border: none;
		text-decoration: none;
		box-sizing: border-box;
		padding: 0.2em 0 0;
		width: fit-content;
		min-height: 2.5rem;
		height: fit-content;
		font: inherit;
		outline: none;
	}

	.root.fill { width: 100%; }

	.back {
		background: var(--btn-deep, color-mix(in srgb, var(--primary) 80%, black));
		border-radius: 0.7em;
		transform: translateY(0);
		width: 100%;
		height: 100%;
	}

	.front {
		background: var(--btn-bg, var(--primary));
		border: 0.1em solid var(--btn-deep, color-mix(in srgb, var(--primary) 80%, black));
		border-radius: 0.7em;
		box-sizing: border-box;
		color: var(--btn-fg, #ffffff);
		width: 100%;
		height: 100%;
		transform: translateY(-0.15em);
		transition: transform 150ms;
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
	.root.ghost .back { background: var(--outline); }

	.root.ghost .front,
	.root.ghost .back { border-color: transparent; background: transparent; }

	.root.danger .front { background: #b42318; border-color: #8d1c13; }
	.root.danger .back { background: #8d1c13; }

	.root:active:not(:disabled) .front {
		transform: translateY(0);
	}

	.root:where(:global(:hover, :focus-visible)) .front {
		transform: translateY(-0.3em);
	}

	.root:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 45%, transparent); outline-offset: 3px; }
</style>
