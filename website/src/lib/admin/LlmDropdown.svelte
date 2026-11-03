<script lang="ts">
	import type { Component } from 'svelte';

	type Option = { value: string; label: string; icon?: string | Component };
	let {
		id,
		label,
		value,
		options,
		onselect,
		disabled = false
	}: {
		id: string;
		label: string;
		value: string;
		options: Option[];
		onselect: (value: string) => void;
		disabled?: boolean;
	} = $props();
	let trigger: HTMLButtonElement;
	let popover: HTMLDivElement;
	let open = $state(false);
	const selected = $derived(options.find((option) => option.value === value));
	$effect(() => {
		if (disabled && open) popover.hidePopover();
	});

	function focusOption(index: number) {
		popover.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus();
	}

	function pick(next: string) {
		if (disabled) return;
		onselect(next);
		popover.hidePopover();
		trigger.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		const items = [...popover.querySelectorAll<HTMLButtonElement>('[role="option"]')];
		const index = items.indexOf(event.target as HTMLButtonElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			focusOption((index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			focusOption(event.key === 'Home' ? 0 : items.length - 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			popover.hidePopover();
			trigger.focus();
		} else if (event.key === 'Tab') {
			popover.hidePopover();
			trigger.focus();
		} else if (
			event.key.length === 1 &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			event.key !== ' '
		) {
			const next = options.findIndex((_, offset) =>
				options[(index + offset + 1) % options.length].label
					.toLocaleLowerCase()
					.startsWith(event.key.toLocaleLowerCase())
			);
			if (next >= 0) {
				event.preventDefault();
				focusOption((index + next + 1) % options.length);
			}
		}
	}
</script>

{#snippet optionLabel(option: Option)}
	<span class="option-label">
		{#if typeof option.icon === 'string'}
			<img class="provider-icon" src={option.icon} alt="" />
		{:else if option.icon}
			<span class="activity-icon" aria-hidden="true"><option.icon /></span>
		{/if}
		<span>{option.label}</span>
	</span>
{/snippet}

<div class="field">
	<span id="{id}-label">{label}</span>
	<button
		bind:this={trigger}
		type="button"
		class="trigger"
		{disabled}
		popovertarget={id}
		style:anchor-name="--{id}"
		aria-labelledby="{id}-label {id}-value"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={id}
		onkeydown={(event) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				popover.showPopover();
			}
		}}
	>
		<span id="{id}-value" class="value">
			{#if selected}{@render optionLabel(selected)}{/if}
		</span>
		<span class="chevron" aria-hidden="true"></span>
	</button>
</div>

<div
	bind:this={popover}
	{id}
	popover="auto"
	class="dropdown"
	style:position-anchor="--{id}"
	role="listbox"
	tabindex="-1"
	aria-labelledby="{id}-label"
	ontoggle={(event) => {
		open = (event as ToggleEvent).newState === 'open';
		if (open) focusOption(Math.max(0, options.findIndex((option) => option.value === value)));
	}}
	onkeydown={onKeydown}
>
	{#each options as option (option.value)}
		<button
			type="button"
			role="option"
			tabindex="-1"
			value={option.value}
			{disabled}
			aria-selected={option.value === value}
			class:selected={option.value === value}
			onclick={() => pick(option.value)}
		>
			{@render optionLabel(option)}
			{#if option.value === value}<span class="check" aria-hidden="true"></span>{/if}
		</button>
	{/each}
</div>

<style>
	.field { display: grid; gap: .4rem; min-width: 0; }
	.trigger { appearance: none; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 1rem; width: 100%; min-height: 2.75rem; border: 1px solid var(--outline); border-radius: .4rem; padding: .5rem .7rem; font: inherit; text-align: start; color: inherit; background: var(--surface); cursor: pointer; }
	.trigger:hover:not(:disabled), .trigger[aria-expanded='true'] { border-color: var(--primary); }
	.trigger:disabled { opacity: .6; cursor: not-allowed; }
	.trigger:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; }
	.chevron { flex: none; width: .45em; height: .45em; border-inline-end: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: translateY(-25%) rotate(45deg); }
	.trigger[aria-expanded='true'] .chevron { transform: translateY(25%) rotate(225deg); }
	.dropdown { position: fixed; position-area: bottom span-right; position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline; inset: unset; box-sizing: border-box; min-width: anchor-size(width); max-width: min(90vw, 30rem); max-height: min(20rem, 60vh); overflow-y: auto; margin: .3rem 0; padding: .3rem; border: 1px solid var(--outline); border-radius: .5rem; color: var(--on-surface); background: var(--surface); box-shadow: 0 2px 4px color-mix(in srgb, var(--on-surface) 8%, transparent), 0 8px 20px color-mix(in srgb, var(--on-surface) 12%, transparent); }
	.dropdown:dir(rtl) { position-area: bottom span-left; }
	.dropdown { overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--outline) transparent; }
	.dropdown::backdrop { background: transparent; }
	.dropdown button { appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 1rem; width: 100%; min-height: 2.5rem; border: 1px solid transparent; border-radius: .35rem; padding: .4rem .65rem; font: inherit; text-align: start; color: inherit; background: transparent; cursor: pointer; }
	.dropdown button:hover, .dropdown button:focus-visible { background: color-mix(in srgb, var(--on-surface) 8%, var(--surface)); }
	.dropdown button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
	.dropdown button.selected { color: var(--on-surface); background: color-mix(in srgb, var(--primary) 8%, var(--surface)); }
	.value, .option-label { min-width: 0; }
	.option-label { display: inline-flex; align-items: center; gap: .65rem; overflow-wrap: anywhere; }
	.activity-icon { display: inline-flex; flex: none; color: var(--primary); }
	.activity-icon :global(svg) { width: 1.35rem; height: 1.35rem; }
	.check { flex: none; width: .35rem; height: .65rem; margin-inline: .3rem; border-right: 2px solid var(--primary); border-bottom: 2px solid var(--primary); transform: rotate(45deg); }
	.provider-icon { box-sizing: border-box; width: 1.35rem; height: 1.35rem; flex: none; object-fit: contain; border-radius: .25rem; padding: .12rem; background: #fff; }
</style>
