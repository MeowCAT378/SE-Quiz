<script lang="ts">
	import { backOut } from 'svelte/easing';
	import { scale } from 'svelte/transition';
	import * as m from '$lib/paraglide/messages.js';
	import Avatar from './Avatar.svelte';

	let {
		players = $bindable(),
		avatars = {},
		selectable = false,
		max = undefined,
		exactCount,
		onchoose,
		onkick
	}: {
		players: [string, boolean][];
		avatars?: Record<string, string>;
		selectable?: boolean;
		max?: undefined | number;
		exactCount: number;
		onchoose?: (players: string[]) => void;
		onkick?: (name: string) => void;
	} = $props();

	const interactive = $derived(selectable || onkick !== undefined);
</script>

{#each players as [player, selected], index (player)}
  <button
    class="player"
    class:kickable={onkick !== undefined && !selectable}
    class:selected
    disabled={!interactive}
    title={onkick !== undefined && !selectable
      ? m.remove_player({ name: player })
      : undefined}
    aria-label={onkick !== undefined && !selectable
      ? m.remove_player({ name: player })
      : undefined}
    onclick={() => {
      if (selectable) {
        if (
          !selected &&
          players.filter(([, s]) => s).length >= (max ?? players.length)
        ) {
          return;
        }
        players[index][1] = !selected;
        onchoose?.(players.filter(([, sel]) => sel).map(([name]) => name));
        return;
      }
      onkick?.(player);
    }}
    transition:scale={{ duration: 300, easing: backOut }}
  >
    <Avatar id={avatars[player]} />
    {player}
  </button>
{/each}
{#if players.length < exactCount}
  <div class="player">
    {m.more({
      count: players.length - exactCount,
    })}
  </div>
{/if}

<style>
  .player {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    background: var(--surface-variant);
    border: none;
    padding: 0.3em 0.6em;
    border-radius: 0.6em;
    font-family: inherit;
    font-size: inherit;
    font-weight: bold;
    word-break: break-word;
    color: inherit;
    cursor: default;
    transition:
      color 100ms linear,
      background 100ms linear;
  }
  .player:not(:disabled) {
    cursor: pointer;
  }
  .player.selected {
    color: var(--primary);
  }
  .kickable:hover,
  .kickable:focus-visible {
    background: color-mix(in srgb, var(--surface-variant) 80%, red);
    text-decoration: line-through;
  }
</style>
