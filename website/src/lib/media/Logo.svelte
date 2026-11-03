<script lang="ts">
	import logo from '$lib/assets/logo.svg';
	import darkLogo from '$lib/assets/logo_dark.svg';
	import * as m from '$lib/paraglide/messages.js';
	import { theme } from '$lib/ui/theme.svelte';

	let { height = 60 }: { height?: number } = $props();
</script>

<div class="outer">
	<div class="inner" style:--h="{height}px">
		<img height="100%" src={theme.current === 'dark' ? darkLogo : logo} alt={m.logo_alt()} />
	</div>
</div>

<style>
	.outer {
		height: 100%;
		display: flex;
	}

	.inner {
		margin-inline-end: auto;
		display: flex;
		align-items: center;
		width: auto;
		height: var(--h);
	}
</style>
