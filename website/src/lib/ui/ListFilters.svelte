<script lang="ts">
	import { parseListDate, reversedDates } from '$lib/listFilters';
	import * as m from '$lib/paraglide/messages.js';
	import FancyButton from './FancyButton.svelte';
	import ListDateInput from './ListDateInput.svelte';

	let {
		query = $bindable(''),
		start = $bindable(''),
		end = $bindable(''),
		dateLabel,
		count,
		total
	}: {
		query?: string;
		start?: string;
		end?: string;
		dateLabel: string;
		count: number;
		total: number;
	} = $props();
	let invalid = $derived(reversedDates(start, end));
	let malformed = $derived(parseListDate(start) === null || parseListDate(end) === null);
	const errorId = $props.id();
</script>

<div class="filters">
	<label class="search">{m.list_search_title()}<input type="search" bind:value={query} /></label>
	<fieldset>
		<legend>{dateLabel}</legend>
		<ListDateInput label={m.list_date_from()} bind:value={start} {invalid} describedBy={malformed || invalid ? errorId : undefined} />
		<ListDateInput label={m.list_date_to()} bind:value={end} {invalid} describedBy={malformed || invalid ? errorId : undefined} />
	</fieldset>
	<FancyButton variant="outline" onclick={() => { query = ''; start = ''; end = ''; }} disabled={!query && !start && !end}>{m.list_clear_filters()}</FancyButton>
</div>
{#if malformed}
	<p id={errorId} role="alert">{m.list_date_invalid({ format: m.list_date_placeholder() })}</p>
{:else if invalid}
	<div id={errorId} class="range-error" role="alert">
		<span>{m.list_date_error()}</span>
		<FancyButton variant="outline" onclick={() => { [start, end] = [end, start]; }}>{m.list_swap_dates()}</FancyButton>
	</div>
{/if}
<p class="count" role="status" aria-live="polite">{m.list_result_count({ count, total })}</p>

<style>
	.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; }
	label { display: grid; gap: 0.35rem; min-width: 0; font-size: 1rem; }
	.search { flex: 1 1 14rem; }
	fieldset { display: flex; flex-wrap: wrap; gap: 0.6rem; border: 0; padding: 0; margin: 0; min-width: 0; flex: 0 1 23rem; }
	legend { padding: 0; margin-bottom: 0.35rem; font-size: 1rem; }
	input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 0.5rem; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--outline); border-radius: 0.5em; }
	input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
	.range-error { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
	.count { margin: 0.5rem 0; font-size: 1rem; font-variant-numeric: tabular-nums; }
	@media (max-width: 40em) { fieldset { flex-basis: 100%; } }
</style>
