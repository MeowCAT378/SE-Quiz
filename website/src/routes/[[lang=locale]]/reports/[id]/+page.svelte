<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { downloadBlob, downloadReportXlsx } from '$lib/clientOnly';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import ErrorPage from '$lib/feedback/ErrorPage.svelte';
	import Loading from '$lib/feedback/Loading.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { hasResponses, reportToCsv, responsesToCsv } from '$lib/reports';
	import type { Database, InternalReport } from '$lib/storage';
	import {
		deleteReport,
		findCreationByUniqueId,
		getReport,
		loadDatabase,
		type ReportId
	} from '$lib/storage';
	import { storageErrorMessage } from '$lib/storage/feedback';
	import { authorizeReportExport } from '$lib/storage/privateExport';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import ReportBody from '$lib/ui/ReportBody.svelte';
	import Delete from '~icons/material-symbols/delete-outline';
	import Download from '~icons/material-symbols/download';
	import Warning from '~icons/material-symbols/warning-outline';
	import ReportTitle from './ReportTitle.svelte';

	let id = $derived(parseInt(page.params.id ?? '', 10));

	const dateFormat = new Intl.DateTimeFormat(getLocale(), {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	let reportTitle = $state<ReportTitle>();
	let pageDatabase: Database;
	let deleteDialog = $state<ConfirmationDialog>();
	let exporting = $state(false);
	let exportError = $state('');

	async function load(id: ReportId) {
		const database = await loadDatabase();
		pageDatabase = database;
		const report = await getReport(id, database);
		if (!report) return undefined;
		const origin = report.fuizUniqueId
			? await findCreationByUniqueId(report.fuizUniqueId, database)
			: undefined;
		pageTitle = report.title;
		return { report, origin, database };
	}

	// Tracked separately from the {#await} so <svelte:head> can stay at the top level.
	let pageTitle = $state<string>(m.reports());

	async function remove() {
		try {
			await deleteReport(id, pageDatabase);
			await goto(resolve(localizeHref('/reports')));
		} catch (cause) {
			exportError = storageErrorMessage(cause);
		}
	}

	async function exportExcel(
		report: InternalReport,
		format: 'xlsx' | 'results' | 'responses' = 'xlsx'
	) {
		exporting = true;
		exportError = '';
		try {
			if (!(await reportTitle?.flush())) return;
			await authorizeReportExport(report, pageDatabase);
			const current = await getReport(id, pageDatabase);
			if (!current) return;
			if (format === 'xlsx')
				await downloadReportXlsx(current, () => authorizeReportExport(current, pageDatabase!));
			else
				downloadBlob(
					[format === 'results' ? reportToCsv(current) : responsesToCsv(current)],
					`${current.title} ${format}.csv`,
					{ type: 'text/csv;charset=utf-8' }
				);
		} catch (error) {
			console.error('Failed to export Excel report', error);
			exportError = storageErrorMessage(error, m.export_excel_failed());
		} finally {
			exporting = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta property="og:title" content={pageTitle} />
</svelte:head>

{#if Number.isNaN(id)}
	<ErrorPage errorMessage={m.no_reports_title()} />
{:else}
	{#await load(id)}
		<Loading />
	{:then loaded}
		{#if !loaded}
			<ErrorPage errorMessage={m.no_reports_title()} />
		{:else}
			{@const { report, origin, database } = loaded}
			{@const drifted =
				origin !== undefined &&
				report.fuizVersionId !== undefined &&
				origin.versionId !== report.fuizVersionId}

			<TypicalPage>
				<div class="wrapper">
					<ReportTitle bind:this={reportTitle} {id} {report} {database} />
					<div class="when">
						{m.played_on({ date: dateFormat.format(report.playedAt) })}
						{#if report.gameCode}
							· {m.game_code()}
							{report.gameCode}
						{/if}
					</div>

					{#if !origin}<p>{m.legacy_unavailable_origin()}</p>{/if}
					{#if drifted}
						<div class="notice">
							<Warning height="1.1em" width="1.1em" />
							<span>{m.report_quiz_changed()}</span>
						</div>
					{/if}

					<div class="actions">
						<div class="action-container">
							<FancyButton height="100%" onclick={() => exportExcel(report)} disabled={exporting}>
								<div class="action">
									<Download height="1.1em" width="1.1em" />
									<span>{m.export_excel()}{exporting ? '…' : ''}</span>
								</div>
							</FancyButton>
						</div>
						<div class="action-container">
							<FancyButton
								height="100%"
								onclick={() => exportExcel(report, 'results')}
							>
								<div class="action">
									<Download height="1.1em" width="1.1em" />
									<span>{m.download_results()}</span>
								</div>
							</FancyButton>
						</div>
						{#if hasResponses(report)}
							<div class="action-container">
								<FancyButton
									height="100%"
									onclick={() => exportExcel(report, 'responses')}
								>
									<div class="action">
										<Download height="1.1em" width="1.1em" />
										<span>{m.download_responses()}</span>
									</div>
								</FancyButton>
							</div>
						{/if}
						{#if origin}
							<div class="action-container">
								<FancyButton
									height="100%"
									palette="secondary"
									onclick={() => goto(resolve(localizeHref(`/quiz/${origin.id}`)))}
								>
									<div class="action">{m.open_quiz()}</div>
								</FancyButton>
							</div>
						{/if}
						<div class="action-container">
							<FancyButton height="100%" palette="tertiary" onclick={() => deleteDialog?.open()}>
								<div class="action">
									<Delete height="1.1em" width="1.1em" />
									<span>{m.delete_report()}</span>
								</div>
							</FancyButton>
						</div>
					</div>
					{#if exportError}<div class="export-error">{exportError}</div>{/if}

					<ReportBody {report} />
				</div>
			</TypicalPage>

			<ConfirmationDialog
				bind:this={deleteDialog}
				title={m.delete_report()}
				message={m.delete_report_message()}
				confirmText={m.delete_confirm()}
				onConfirm={remove}
			/>
		{/if}
	{:catch cause}<p role="alert">{storageErrorMessage(cause)}</p>{/await}
{/if}

<style>
	.wrapper {
		max-width: 70ch;
		margin: 1em auto;
		padding: 0 0.4em;
	}

	.when {
		font-size: 0.75em;
		opacity: 0.65;
		margin-bottom: 0.8em;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.4em;
		background: var(--primary-container);
		color: var(--on-primary-container);
		border-radius: 0.7em;
		padding: 0.5em 0.7em;
		font-size: 0.8em;
		margin-bottom: 0.8em;
	}





	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
		grid-auto-rows: 1fr;
		gap: 0.5em;
		font-size: 0.85em;
	}

	.actions .action-container {
		min-width: 0;
	}

	.action {
		padding: 0 0.3em;
		height: 100%;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4em;
	}

	.action span {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.action :global(svg) {
		flex-shrink: 0;
	}

	.export-error {
		color: var(--primary);
		font-size: 0.8em;
		margin-top: 0.35em;
	}





















</style>
