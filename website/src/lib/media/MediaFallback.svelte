<script lang="ts">
	import logo from '$lib/assets/logo.svg';
	import darkLogo from '$lib/assets/logo_dark.svg';
	import * as m from '$lib/paraglide/messages.js';
	import { theme } from '$lib/ui/theme.svelte';
</script>

<div class="fallback">
	<img src={theme.current === 'dark' ? darkLogo : logo} alt={m.logo_alt()} />
</div>

<style>
	.fallback {
		height: 100%;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.25;
		box-sizing: border-box;
	}

	.fallback img {
		width: min(65%, 13rem);
		height: auto;
		max-height: 65%;
		object-fit: contain;
	}
</style>
