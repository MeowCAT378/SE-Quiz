<script lang="ts">
	import { buttonSymbols } from '$lib/clientOnly';
	import FancyButton from '$lib/ui/FancyButton.svelte';

	let {
		index,
		onclick
	}: {
		index: number;
		onclick?: () => void;
	} = $props();

	let buttonSymbol = $derived(buttonSymbols[index % buttonSymbols.length]);
</script>

<div class="wrapper">
  <FancyButton {onclick} palette={index} height="100%">
    <div class="content">
      <span class="sr-only">{buttonSymbol.label}</span>
      <div class="icon">
        <buttonSymbol.icon aria-hidden="true" height="100%" width="100%" />
      </div>
    </div>
  </FancyButton>
</div>

<style>
  .wrapper {
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .content {
    height: 100%;
    width: 100%;
    min-height: 1.5em;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .icon {
    aspect-ratio: 1;
    max-height: 75%;
    max-width: 75%;
    display: flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
  }
</style>
