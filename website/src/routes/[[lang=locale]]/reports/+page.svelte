<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Loading from '$lib/feedback/Loading.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import { matchesListFilters } from '$lib/listFilters';
	import * as m from '$lib/paraglide/messages.js';
	import { getAllReports, loadDatabase, onAccountStorageCleared } from '$lib/storage';
	import { storageErrorMessage } from '$lib/storage/feedback';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import ListFilters from '$lib/ui/ListFilters.svelte';
	import ReportCard from '$lib/ui/ReportCard.svelte';

	let reports = $state<Awaited<ReturnType<typeof getAllReports>>>([]);
	let loading = $state(true);
	let loadError = $state('');
	let query = $state('');
	let start = $state('');
	let end = $state('');
	let heading: HTMLHeadingElement;
	let generation = 0;
	let active = false;
	let sessionError = $state(false);
	let visible = $derived(
		reports.filter(([, report]) =>
			matchesListFilters(report.title, report.playedAt, query, start, end)
		)
	);
	async function load(retry = false) {
		if (active) return;
		active = true;
		const current = ++generation;
		loading = true;
		loadError = '';
		reports = [];
		try {
			const db = await loadDatabase();
			const result = await getAllReports(db);
			if (current !== generation || db.closed) return;
			reports = result;
			sessionError = false;
		} catch (cause) {
			if (current !== generation) return;
			sessionError = [401, 403].includes((cause as { status?: number })?.status ?? 0);
			loadError = storageErrorMessage(cause, m.list_reports_load_error());
		} finally {
			if (current === generation) {
				active = false;
				loading = false;
				if (retry) {
					await tick();
					heading?.focus();
				}
			}
		}
	}
	onMount(() => {
		const remove = onAccountStorageCleared(() => {
			generation++;
			active = false;
			reports = [];
			loading = false;
			sessionError = true;
			loadError = m.private_session_error();
		});
		void load();
		return () => {
			generation++;
			remove();
		};
	});
</script>

<svelte:head>
	<title>{m.reports()}</title>
	<meta property="og:title" content={m.reports()} />
</svelte:head>

	<TypicalPage>
		<div class="wrapper">
			<h2 bind:this={heading} tabindex="-1">{m.reports()}</h2>
			<ListFilters bind:query bind:start bind:end dateLabel={m.list_report_date()} count={visible.length} total={reports.length} />
			{#if loading}
				<Loading />
			{:else if loadError}
				<p role="alert">{loadError}</p>
				{#if !sessionError}<FancyButton onclick={() => { void load(true); }}>{m.private_retry()}</FancyButton>{/if}
			{:else if reports.length === 0}
				<div class="empty">
					<div class="empty-title">{m.no_reports_title()}</div>
					<div class="empty-detail">{m.no_reports_detail()}</div>
				</div>
			{:else if !visible.length}
				<p role="status">{m.list_no_matches()}</p>
			{:else}
				<ul class="list">
					{#each visible as [id, report] (id)}
						<li><ReportCard {id} {report} /></li>
					{/each}
				</ul>
			{/if}
		</div>
	</TypicalPage>

<style>
	.wrapper {
		max-width: 90ch;
		margin: 1em auto;
		padding: 0 0.4em;
	}

	h2 {
		font-family: var(--alternative-font);
		line-height: 1;
		margin: 0 0 0.4em;
		opacity: 0.7;
	}

	.empty {
		border: 1px dashed var(--outline);
		border-radius: 0.7em;
		padding: 1.5em 1em;
		text-align: center;
	}

	.empty-title {
		font-weight: 700;
	}

	.empty-detail {
		font-size: 0.8em;
		opacity: 0.7;
		margin-top: 0.2em;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 22ch), 1fr));
		gap: 0.5em;
	}
</style>
