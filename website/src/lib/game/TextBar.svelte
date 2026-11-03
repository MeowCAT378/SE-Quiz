<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';

	import FancyButton from '$lib/ui/FancyButton.svelte';

	let {
		text,
		showNext = false,
		heading = false,
		maxLines,
		onnext
	}: {
		text: string;
		showNext?: boolean;
		heading?: boolean;
		maxLines?: number;
		onnext?: () => void;
	} = $props();

	let barElement: HTMLDivElement;
	let textElement: HTMLDivElement;

	function fitText() {
		if (!maxLines || !textElement) return;
		textElement.style.fontSize = '';
		const largest = Number.parseFloat(getComputedStyle(textElement).fontSize);
		const fits = (size: number) => {
			textElement.style.fontSize = `${size}px`;
			const style = getComputedStyle(textElement);
			const lineHeight = Number.parseFloat(style.lineHeight);
			const maxHeight = Number.parseFloat(style.maxHeight) || Infinity;
			return textElement.scrollHeight <= Math.min(lineHeight * maxLines, maxHeight) + 1;
		};
		if (fits(largest)) return;
		// ponytail: 12px is the readability floor; the three-line clamp handles longer text.
		let low = 12;
		let high = largest;
		if (!fits(low)) return;
		for (let i = 0; i < 8; i++) {
			const middle = (low + high) / 2;
			if (fits(middle)) low = middle;
			else high = middle;
		}
		textElement.style.fontSize = `${low}px`;
	}

	onMount(() => {
		if (!maxLines) return;
		let width = 0;
		let frame = 0;
		const scheduleFit = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(fitText);
		};
		const observer = new ResizeObserver(() => {
			if (barElement.clientWidth === width) return;
			width = barElement.clientWidth;
			scheduleFit();
		});
		observer.observe(barElement);
		// The font size and height limit also depend on viewport height.
		window.addEventListener('resize', scheduleFit);
		document.fonts.ready.then(fitText);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', scheduleFit);
			cancelAnimationFrame(frame);
		};
	});

	$effect(() => {
		text;
		if (maxLines) queueMicrotask(fitText);
	});
</script>

<div class="bar" bind:this={barElement}>
  <div class="text" class:heading class:limited={maxLines} bind:this={textElement} style:--max-lines={maxLines}>
    {text}
  </div>
  {#if showNext}
    <div class="next">
      <FancyButton onclick={onnext}>
        <div class="next-padding">{m.next()}</div>
      </FancyButton>
    </div>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    line-height: 1.5;
    align-items: center;
    justify-content: center;
    padding: 0.4em 0.6em;
    text-align: center;
  }

  .text {
    flex: 1;
    font-size: var(--host-question-size, 1.8em);
    font-weight: 500;
    word-break: break-word;
    min-width: var(--host-min-width, auto);
    max-height: var(--host-question-max-height, none);
    overflow-y: var(--host-text-overflow, visible);
  }

  .text.heading {
    font-family: var(--alternative-font);
  }

  .text.limited {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: var(--max-lines);
    -webkit-line-clamp: var(--max-lines);
    overflow: hidden;
  }

  .next {
    font-size: 1.2em;
    font-family: var(--alternative-font);
    margin-inline-start: 0.6em;
  }

  .next-padding {
    padding: 0.2em 0.4em;
  }

  @media (max-width: 600px) {
    .bar {
      padding: 0.2em 0.4em;
    }

    .text {
      font-size: var(--host-question-size, 1.5em);
    }

    .next {
      font-size: 1em;
    }
  }
</style>
