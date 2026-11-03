<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { type Database, type InternalReport, type ReportId, updateReport } from '$lib/storage';
	import SaveFeedback from '$lib/storage/SaveFeedback.svelte';
	import { guardUnsavedNavigation } from '$lib/storage/saveNavigation';
	import { createSaveQueue, type SaveState } from '$lib/storage/saveQueue';
	import Textbox from '$lib/ui/Textbox.svelte';
	import Edit from '~icons/material-symbols/edit-outline';

	let { id, report, database }: { id: ReportId; report: InternalReport; database: Database } =
		$props();

	// The stored record is tracked locally so each save builds on the version it produced;
	// the prop is only ever the starting point, so the initial read is deliberate.
	let current = $state(untrack(() => report));
	let title = $state(untrack(() => report.title));

	let saveState = $state<SaveState>('saved');
	let saveError = $state<unknown>();
	let warning = $state(false);
	let timer: ReturnType<typeof setTimeout>;
	const saver = createSaveQueue(
		(value: string) => ({ ...$state.snapshot(current), title: value }),
		async (candidate) => {
			current = await updateReport(id, candidate, database);
			warning = !!database.syncWarning;
		},
		(state, cause) => {
			saveState = state;
			saveError = cause;
		}
	);
	let previous = untrack(() => title);
	$effect(() => {
		const value = title;
		untrack(() => {
			if (value === previous) return;
			previous = value;
			saver.set(value);
			clearTimeout(timer);
			if (saveState !== 'error')
				timer = setTimeout(() => {
					void flush();
				}, 600);
		});
	});
	export async function flush() {
		clearTimeout(timer);
		try {
			await saver.flush();
			return true;
		} catch {
			return false;
		}
	}
	onDestroy(() => clearTimeout(timer));
	guardUnsavedNavigation(
		() => saveState !== 'saved',
		() => database.closed,
		flush
	);
</script>

<div class="title-row">
	<Edit height="1em" width="1em" />
	<Textbox
		bind:value={title}
		placeholder={m.report_name()}
		textAlign="start"
		padding="0.1em 0.2em"
		maxLength={100}
	/>
</div>

<SaveFeedback state={saveState} error={saveError} {warning} retry={() => { void flush(); }} />
<style>
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.3em;
		font-family: var(--alternative-font);
		font-weight: 800;
		font-size: 1.3em;
		opacity: 0.9;
	}
</style>
