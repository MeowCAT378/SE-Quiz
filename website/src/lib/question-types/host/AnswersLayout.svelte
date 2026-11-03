<script lang="ts">
	import think from '$lib/assets/music/kevin_macleod_thinking_music.mp3';
	import Audio from '$lib/media/Audio.svelte';
	import MediaContainer from '$lib/media/MediaContainer.svelte';
	import type { Media } from '$lib/types';
	import HostLayout from './HostLayout.svelte';
	import QuestionHeader from './QuestionHeader.svelte';
	import type { BindableGameInfo, SharedGameInfo } from './types';

	let {
		bindableGameInfo = $bindable(),
		gameInfo,
		questionText,
		timeLeft,
		timeStarted,
		answeredCount,
		media,
		onlock,
		onnext,
		children
	}: {
		bindableGameInfo: BindableGameInfo;
		gameInfo: SharedGameInfo;
		questionText: string;
		timeLeft: number | null;
		timeStarted: number | null;
		answeredCount: number;
		media: Media | undefined;
		onlock?: (locked: boolean) => void;
		onnext?: () => void;
		children: import('svelte').Snippet;
	} = $props();
</script>

<Audio audioUrl={think} volumeOn={bindableGameInfo.volumeOn} />
<HostLayout
	bind:bindableGameInfo
	{gameInfo}
	{onlock}
	{onnext}
	textForward={!media}
	responses={{ count: answeredCount }}
>
	<QuestionHeader {questionText} {timeLeft} {timeStarted} />
	<div class="body" class:no-media={!media}>
		{#if media}
			<div class="media-area">
				<MediaContainer {media} showFallback={false} />
			</div>
		{/if}
		<div class="answer-region">
			{@render children()}
		</div>
	</div>
</HostLayout>

<style>
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		min-width: 0;
	}

	.answer-region {
		min-height: 0;
		min-width: 0;
		max-height: 55%;
		overflow: auto;
		overflow-wrap: anywhere;
	}

	.no-media .answer-region {
		flex: 1;
		max-height: none;
		display: flex;
		flex-direction: column;
		justify-content: safe center;
		padding: var(--host-content-gap);
	}

	.no-media .answer-region > :global(*) {
		flex-shrink: 0;
		min-width: 0;
	}

	.no-media .answer-region > :global(.answers-large),
	.no-media .answer-region > :global(.answers),
	.no-media .answer-region > :global(.board),
	.no-media .answer-region > :global(.wrap) {
		flex: 1;
		max-height: none;
	}

	.media-area {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
	}
</style>
