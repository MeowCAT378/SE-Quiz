<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Palette } from '$lib/clientOnly';
	import FancyAnchorButtonBase from './FancyAnchorButtonBase.svelte';

	let {
		palette = undefined,
		variant = 'primary',
		fill = false,
		href,
		download,
		children
	}: {
		palette?: Palette;
		variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
		fill?: boolean;
		href: string;
		download?: unknown;
		children?: Snippet;
	} = $props();
</script>

<FancyAnchorButtonBase {palette} {variant} {fill} {href} {download}>
	<div class="content">
		{@render children?.()}
	</div>
</FancyAnchorButtonBase>

<style>
	.content {
		height: 100%;
		padding: 5px;
		font-weight: bold;
		box-sizing: border-box;
	}
</style>
