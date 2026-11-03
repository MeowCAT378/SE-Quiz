<script lang="ts">
	import { avatars, avatarUrl } from './avatars';

	let {
		id,
		size = 64,
		blink = false,
		breathe = false,
		swayHair = false,
		wave = false
	}: {
		id?: string;
		size?: 64 | 128 | 192;
		blink?: boolean;
		breathe?: boolean;
		swayHair?: boolean;
		wave?: boolean;
	} = $props();
	// Closed eye, skin, and sleeve colors follow the 32px portraits in draw-avatars.py.
	const palettes = [
		['#cf8f71', '#f4c798', '#91c8e9'],
		['#4d3335', '#71483c', '#73549f'],
		['#613f3c', '#8b5b48', '#54876d'],
		['#a16752', '#d29a72', '#be6942'],
		['#cf8f71', '#f4c798', '#455c7c'],
		['#b67961', '#e7b084', '#e17f78'],
		['#a16752', '#d29a72', '#e5d9b9'],
		['#613f3c', '#8b5b48', '#4d9b9d'],
		['#4d3335', '#71483c', '#9a85bb'],
		['#b67961', '#e7b084', '#6689a9'],
		['#cf8f71', '#f4c798', '#484852'],
		['#a16752', '#d29a72', '#b65c50'],
		['#4d3335', '#71483c', '#c2a24d'],
		['#613f3c', '#8b5b48', '#71835a'],
		['#b67961', '#e7b084', '#6bbdb3'],
		['#cf8f71', '#f4c798', '#537bb2'],
		['#a16752', '#d29a72', '#805477'],
		['#613f3c', '#8b5b48', '#777e85'],
		['#b67961', '#e7b084', '#56866e'],
		['#4d3335', '#71483c', '#e6dcc1']
	];
	let palette = $derived(palettes[avatars.findIndex((avatar) => avatar.id === id)] ?? palettes[0]);
	// Avatar 8's top pixels are a beanie, so keep them still.
	let visibleHair = $derived(swayHair && id !== 'avatar-08');
</script>

<span class="portrait" style:--avatar-size={`${size}px`}>
	<img class:hair-base={visibleHair} src={avatarUrl(id)} alt="" width={size} height={size} />
	{#if visibleHair}
		<span class="hair-layer" style:background-image={`url("${avatarUrl(id)}")`} aria-hidden="true"></span>
	{/if}
	{#if breathe}
		<span class="breath" style:background-image={`url("${avatarUrl(id)}")`} aria-hidden="true"></span>
	{/if}
	{#if blink && id !== 'avatar-07' && id !== 'avatar-16'}
		<span class="eyelids" style:--eyelid-color={palette[0]} aria-hidden="true">
			<span class="eye left"></span><span class="eye right"></span>
		</span>
	{/if}
	{#if wave}
		<svg class="wave-arm" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
			<path d="M24 12h6v1h1v7h-1v1h-2v5h1v3h-6v-3h1v-5h-2v-2h-1v-3h2v-3h1z" fill="#252737" />
			<path d="M25 13h5v7h-2v1h-1v5h-2v-6h-2v-1h-1v-2h2v-3h1z" fill={palette[1]} />
			<path d="M26 14h1v2h-1z M28 14h1v2h-1z" fill={palette[0]} />
			<path d="M23 26h6v3h-6z" fill={palette[2]} />
		</svg>
	{/if}
</span>

<style>
	.portrait {
		display: inline-flex;
		width: var(--avatar-size);
		height: var(--avatar-size);
		flex: none;
		position: relative;
		border-radius: 50%;
		background: color-mix(in srgb, var(--primary) 16%, var(--surface));
		overflow: hidden;
	}
	img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
	img.hair-base { clip-path: inset(25% 0 0); }
	.hair-layer {
		position: absolute;
		inset: 0;
		background-size: 100% 100%;
		image-rendering: pixelated;
		clip-path: inset(0 0 75%);
		animation: hair-sway 4.8s ease-in-out infinite;
		pointer-events: none;
	}
	.breath {
		position: absolute;
		inset: 0;
		background-size: 100% 100%;
		image-rendering: pixelated;
		clip-path: inset(75% 0 0);
		transform-origin: center bottom;
		animation: breathe 3.6s ease-in-out infinite;
		pointer-events: none;
	}
	.eyelids { position: absolute; inset: 0; pointer-events: none; }
	.eye {
		position: absolute;
		top: 43.75%;
		width: 6.25%;
		height: 3.125%;
		background: var(--eyelid-color);
		opacity: 0;
		animation: blink 3s steps(1, end) infinite;
	}
	.eye.left { left: 40.625%; }
	.eye.right { left: 56.25%; }
	.wave-arm {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		transform-origin: 78% 88%;
		animation: wave 900ms steps(1, end) both;
	}
	@keyframes blink {
		0%, 93%, 97%, 100% { opacity: 0; }
		94%, 96% { opacity: 1; }
	}
	@keyframes breathe {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.035, 1.025); }
	}
	@keyframes hair-sway {
		0%, 50%, 100% { transform: translateX(0); }
		25% { transform: translateX(-2px); }
		75% { transform: translateX(2px); }
	}
	@keyframes wave {
		0%, 100% { opacity: 0; transform: rotate(0); }
		10%, 25%, 55%, 75% { opacity: 1; transform: rotate(0); }
		26%, 54%, 76%, 90% { opacity: 1; transform: rotate(-14deg); }
	}
	@keyframes wave-still {
		0%, 100% { opacity: 0; }
		10%, 80% { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.eye { animation: none; }
		.breath { animation: none; }
		.hair-layer { animation: none; }
		.wave-arm { animation: wave-still 450ms steps(1, end) both; }
	}
</style>
