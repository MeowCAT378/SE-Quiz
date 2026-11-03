<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import Join from './Join.svelte';
	import Play from './Play.svelte';

	let code = $derived(page.url.searchParams.get('code')?.trim() || null);

	const title = m.play_title();
	const description = m.play_desc();
</script>

<svelte:head>
	<title>{title}</title>
	<meta property="og:title" content={title} />
	<meta name="description" content={description} />
	<meta property="og:description" content={description} />
	<link rel="canonical" href={env.PUBLIC_PLAY_URL + resolve(localizeHref('/play'))} />
</svelte:head>

{#if code !== null}
	<div class="play-shell">
		<Play {code} />
	</div>
{:else}
	<Join />
{/if}

<style>
	.play-shell {
		display: contents;
		font-size: 0.75em;
	}
</style>
