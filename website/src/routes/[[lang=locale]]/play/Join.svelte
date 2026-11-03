<script lang="ts">
	import JoinForm from '$lib/game/JoinForm.svelte';
	import Footer from '$lib/layout/Footer.svelte';
	import Header from '$lib/layout/Header.svelte';
	import NiceBackground from '$lib/layout/NiceBackground.svelte';
</script>

<NiceBackground>
	<div class="page">
		<header class="header"><Header /></header>
		<div class="join"><JoinForm /></div>
		<Footer />
	</div>
</NiceBackground>

<style>
	.page {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.header { margin: 0.5em 0; }

	.join {
		flex: 1;
		display: flex;
		align-items: center;
		width: min(calc(100% - 2em), 32rem);
	}
</style>
