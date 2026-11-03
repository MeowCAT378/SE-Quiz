<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { downloadFuiz, shareAndCopyURL } from '$lib/clientOnly';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import ErrorPage from '$lib/feedback/ErrorPage.svelte';
	import Loading from '$lib/feedback/Loading.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import MediaContainer from '$lib/media/MediaContainer.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { getPublishedIds } from '$lib/publications';
	import { isScored, overallAccuracy, scoredQuestionCount } from '$lib/reports';
	import {
		accountRequest,
		type CreationId,
		type Database,
		deleteCreation,
		getCreation,
		getLocalReports,
		type InternalReport,
		loadDatabase,
		StorageError,
		verifyAccount
	} from '$lib/storage';
	import { storageErrorMessage } from '$lib/storage/feedback';
	import type { IdlessFullFuizConfig } from '$lib/types';
	import { getMedia, type Media } from '$lib/types';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import OutcomeBar from '$lib/ui/OutcomeBar.svelte';
	import type { OverflowItem } from '$lib/ui/OverflowMenu.svelte';
	import OverflowMenu from '$lib/ui/OverflowMenu.svelte';
	import SectionLabel from '$lib/ui/SectionLabel.svelte';
	import CheckCircle from '~icons/material-symbols/check-circle-outline';
	import Close from '~icons/material-symbols/close';
	import DeleteOutline from '~icons/material-symbols/delete-outline';
	import Download from '~icons/material-symbols/download';
	import Edit from '~icons/material-symbols/edit-outline';
	import Groups from '~icons/material-symbols/groups-outline';
	import Publish from '~icons/material-symbols/publish';
	import Share from '~icons/material-symbols/share';
	import Slideshow from '~icons/material-symbols/slideshow-outline-sharp';

	let { data } = $props();

	let id = $derived(parseInt(page.params.id ?? '', 10));

	const dateFormat = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' });
	const timeFormat = new Intl.DateTimeFormat(getLocale(), {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	let pageDatabase: Database;
	let actionError = $state('');
	async function run(action: () => Promise<void>) {
		actionError = '';
		try {
			await action();
		} catch (cause) {
			actionError = storageErrorMessage(cause);
		}
	}
	let unpublishDialog = $state<ConfirmationDialog>();
	let published = $state<boolean | undefined>(undefined);
	let removing = $state(false);
	let publicationNotice = $state('');
	let publicationError = $state('');
	async function refreshPublication(uniqueId: string) {
		try {
			published = (await getPublishedIds(pageDatabase)).has(uniqueId);
			publicationError = '';
		} catch (cause) {
			publicationError = storageErrorMessage(cause, m.publish_network_failed());
		}
	}
	async function unpublish(uniqueId: string) {
		if (publishing || removing) return;
		removing = true;
		publishSuccess = false;
		actionError = '';
		publicationNotice = '';
		try {
			await accountRequest(pageDatabase, '/admin-api/delete', {
				method: 'POST',
				body: JSON.stringify({ id: uniqueId })
			});
			published = false;
			publicationNotice = m.home_removed();
			await refreshPublication(uniqueId);
		} catch (cause) {
			if (cause instanceof StorageError && cause.status === 404) {
				published = false;
				publicationNotice = m.home_removed();
			} else {
				actionError = storageErrorMessage(cause, m.home_remove_failed());
			}
		} finally {
			removing = false;
		}
	}
	let deleteDialog = $state<ConfirmationDialog>();
	let pageTitle = $state<string>(m.create_title());

	async function load(id: CreationId) {
		const database = await loadDatabase();
		published = undefined;
		pageDatabase = database;
		const fuiz = await getCreation(id, database);
		if (!fuiz) return undefined;

		const reports = (await getLocalReports(database)).filter(
			([, report]) => report.fuizUniqueId === fuiz.uniqueId
		);

		pageTitle = fuiz.config.title;
		if (data.isAdmin) await refreshPublication(fuiz.uniqueId);
		return {
			fuiz,
			media: fuiz.config.slides.reduce<Media | undefined>((p, c) => p || getMedia(c), undefined),
			reports
		};
	}

	/** Summarise only questions with a right answer; opinion slides award no points. */
	function totals(report: InternalReport) {
		const scored = report.questions.filter(isScored);
		const correct = scored.reduce((sum, q) => sum + q.correct, 0);
		const wrong = scored.reduce((sum, q) => sum + q.wrong, 0);
		const answerable = scored.length * report.playerCount;
		return { correct, wrong, unanswered: Math.max(0, answerable - correct - wrong) };
	}

	async function remove() {
		await run(async () => {
			await deleteCreation(id, pageDatabase);
			await goto(resolve(localizeHref('/create')));
		});
	}

	let copiedPopover = $state<HTMLDivElement>();
	let menuWrap = $state<HTMLDivElement>();
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	/** The menu closes on click, so copying needs its own confirmation. */
	async function share() {
		const fresh = await getCreation(id, pageDatabase);
		if (!fresh) throw new StorageError(404);
		await shareAndCopyURL(fresh.config, pageDatabase);
		try {
			copiedPopover?.showPopover({ source: menuWrap });
		} catch {
			/* already shown */
		}
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => {
			try {
				copiedPopover?.hidePopover();
			} catch {
				/* already hidden */
			}
		}, 1500);
	}

	let publishing = $state(false);
	let publishSuccess = $state(false);

	async function publishToServer(fuiz: { uniqueId: string; config: IdlessFullFuizConfig }) {
		if (publishing || removing || published === undefined) return;
		publishing = true;
		actionError = '';
		publicationNotice = '';
		try {
			const fresh = await getCreation(id, pageDatabase);
			if (!fresh) throw new StorageError(404);
			fuiz = fresh;
			const res = await accountRequest(pageDatabase, '/admin-api/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: fuiz.uniqueId,
					config: fuiz.config,
					author: 'Admin',
					language: getLocale()
				})
			});
			if (res.ok) {
				publishSuccess = true;
				published = true;
				await refreshPublication(fuiz.uniqueId);
				setTimeout(() => {
					publishSuccess = false;
				}, 3500);
			} else {
				actionError = m.publish_server_failed({ status: res.status });
			}
		} catch (cause) {
			actionError = storageErrorMessage(cause, m.publish_network_failed());
		} finally {
			publishing = false;
		}
	}

	function menuItems(_config: IdlessFullFuizConfig, fuizObj?: any): OverflowItem[] {
		return [
			...(data.isAdmin && fuizObj
				? [
						{
							label: publishSuccess
								? m.published_to_server()
								: publishing
									? m.publishing_to_server()
									: published
										? m.home_update()
										: m.publish_to_server(),
							disabled: publishing || removing || published === undefined,
							icon: Publish,
							onclick: () => publishToServer(fuizObj)
						}
					]
				: []),
			...(data.isAdmin && published
				? [
						{
							label: removing ? m.home_removing() : m.home_remove(),
							icon: DeleteOutline,
							danger: true,
							disabled: publishing || removing,
							onclick: () => unpublishDialog?.open()
						}
					]
				: []),
			...(data.showShare ? [{ label: m.share(), icon: Share, onclick: () => run(share) }] : []),
			...(data.showPublish
				? [
						{
							label: m.publish(),
							icon: Publish,
							onclick: () => goto(resolve(localizeHref(`/publish?id=${id}`)))
						}
					]
				: []),
			{
				label: m.download(),
				icon: Download,
				onclick: () =>
					run(async () => {
						const fresh = await getCreation(id, pageDatabase);
						if (fresh) await downloadFuiz(fresh.config, () => verifyAccount(pageDatabase));
					})
			},
			{
				label: m.delete_confirm(),
				icon: DeleteOutline,
				danger: true,
				disabled: publishing || removing,
				onclick: () => deleteDialog?.open()
			}
		];
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta property="og:title" content={pageTitle} />
</svelte:head>

{#if Number.isNaN(id)}
	<ErrorPage errorMessage={m.missing_fuiz()} />
{:else}
	{#await load(id)}
		<Loading />
	{:then loaded}
		{#if !loaded}
			<ErrorPage errorMessage={m.missing_fuiz()} />
		{:else}
			{@const { fuiz, media, reports } = loaded}
			<TypicalPage>
				{#if actionError}<p role="alert">{actionError}</p>{/if}
				{#if publicationError}<p role="alert">{publicationError}</p><FancyButton onclick={() => refreshPublication(fuiz.uniqueId)}>{m.private_retry()}</FancyButton>{/if}
				<div class="wrapper">
					<div role="status" aria-live="polite" aria-atomic="true">
						{#if publicationNotice}
							<div class="publication-notice">
								<span class="notice-icon" aria-hidden="true"><CheckCircle width="1.3em" height="1.3em" /></span>
								<p>{publicationNotice}</p>
								<button class="notice-close" type="button" aria-label={m.notification_dismiss()} title={m.notification_dismiss()} onclick={() => { publicationNotice = ''; }}>
									<Close width="1.1em" height="1.1em" />
								</button>
							</div>
						{/if}
					</div>
					<div class="split">
						<aside class="panel">
							<div class="panel-thumb">
								<MediaContainer {media} fit="cover" />
							</div>
							<div class="panel-head">
								<h1 class="panel-title">{fuiz.config.title}</h1>
								<div class="menu-wrap" bind:this={menuWrap}>
									<OverflowMenu
										id="quiz-options"
										label={m.options()}
										items={menuItems(fuiz.config, fuiz)}
									/>
									<div bind:this={copiedPopover} popover="manual" class="fuiz-popover">
										{m.copied()}
									</div>
								</div>
							</div>
							<div class="panel-meta">
								{m.slides_count({ count: fuiz.config.slides.length })}
								· {m.edited_on({ date: dateFormat.format(fuiz.lastEdited) })}
							</div>

							{#if data.isAdmin && published}<p class="published-state"><Publish height="1em" width="1em" />{m.home_published()}</p>{/if}
							<div class="panel-actions">
								<FancyButton onclick={() => goto(resolve(localizeHref(`/quiz/${id}/edit`)))}>
									<div class="action"><Edit height="1.1em" width="1.1em" /> {m.edit()}</div>
								</FancyButton>
								<FancyButton
									palette="secondary"
									onclick={() => goto(resolve(localizeHref(`/quiz/${id}/host`)))}
								>
									<div class="action"><Slideshow height="1.1em" width="1.1em" /> {m.host()}</div>
								</FancyButton>
								{#if data.isAdmin}
									<FancyButton
										onclick={() => publishToServer(fuiz)}
										disabled={publishing || removing || published === undefined}
									>
										<div class="action">
											<Publish height="1.1em" width="1.1em" />
											{publishSuccess ? m.published_to_server() : (publishing ? m.publishing_to_server() : published ? m.home_update() : m.publish_to_server())}
										</div>
									</FancyButton>
									{#if published}<FancyButton variant="danger" disabled={publishing || removing} onclick={() => unpublishDialog?.open()}><div class="action"><DeleteOutline height="1.1em" width="1.1em" />{removing ? m.home_removing() : m.home_remove()}</div></FancyButton>{/if}
								{/if}
							</div>
						</aside>

						<div class="history">
							<SectionLabel --section-label-margin="0 0 0.5em">
								{reports.length
									? m.reports_count({ count: reports.length })
									: m.reports()}
							</SectionLabel>
							{#if reports.length}
								<ol class="runs">
									{#each reports as [reportId, report] (reportId)}
										{@const t = totals(report)}
										<li>
											<a class="run" href={resolve(localizeHref(`/reports/${reportId}`))}>
												<span class="run-when">{timeFormat.format(report.playedAt)}</span>
												<span class="run-players">
													<Groups height="0.9em" width="0.9em" />
													{report.playerCount}
												</span>
												<span class="run-bar">
													<OutcomeBar
														correct={t.correct}
														wrong={t.wrong}
														unanswered={t.unanswered}
													/>
												</span>
												<span class="run-acc">{scoredQuestionCount(report) ? `${Math.round(overallAccuracy(report) * 100)}%` : '—'}</span>
											</a>
										</li>
									{/each}
								</ol>
							{:else}
								<div class="empty">
									<div class="empty-title">{m.not_hosted_yet()}</div>
									<div class="empty-detail">{m.not_hosted_yet_detail()}</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</TypicalPage>

			<ConfirmationDialog bind:this={unpublishDialog} title={m.home_remove_title()} message={m.home_remove_message()} confirmText={m.home_remove()} onConfirm={() => unpublish(fuiz.uniqueId)} />
			<ConfirmationDialog
				bind:this={deleteDialog}
				title={m.delete_forever()}
				message=""
				confirmText={m.delete_confirm()}
				onConfirm={remove}
			/>
		{/if}
	{:catch cause}<p role="alert">{storageErrorMessage(cause)}</p>{/await}
{/if}

<style>
	.publication-notice {
		display: flex;
		align-items: center;
		gap: 0.65em;
		margin-bottom: 1em;
		padding: 0.65em 0.8em;
		border: 1px solid color-mix(in srgb, var(--secondary) 30%, var(--surface));
		border-radius: 0.6em;
		background: color-mix(in srgb, var(--secondary) 8%, var(--surface));
		color: var(--on-surface);
		font-size: 0.85em;
	}

	.publication-notice p {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.notice-icon {
		display: flex;
		flex: 0 0 auto;
		color: var(--secondary);
	}

	.notice-close {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		min-width: 44px;
		min-height: 44px;
		padding: 0.4em;
		border: 0;
		border-radius: 0.4em;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.notice-close:hover {
		background: color-mix(in srgb, var(--secondary) 12%, transparent);
	}

	.notice-close:focus-visible {
		outline: 2px solid var(--secondary);
		outline-offset: 2px;
	}

	.published-state { display: flex; align-items: center; gap: 0.4em; font-size: 0.8em; }
	.wrapper {
		max-width: 78ch;
		margin: 1em auto;
		padding: 0 0.6em;
	}

	.split {
		display: grid;
		grid-template-columns: 15em minmax(0, 1fr);
		gap: 1.2em;
	}

	@media (max-width: 700px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.9em;
		}
	}

	.panel {
		border-right: 1px solid var(--outline);
		padding-right: 1.2em;
	}

	@media (max-width: 700px) {
		.panel {
			border-right: none;
			border-bottom: 1px solid var(--outline);
			padding-right: 0;
			padding-bottom: 1em;
		}
	}

	.panel-thumb {
		/* MediaContainer is `position: absolute; inset: 0`, so it needs a positioned
		   ancestor or it escapes and fills the viewport. */
		position: relative;
		aspect-ratio: 16 / 10;
		border-radius: 0.5em;
		overflow: hidden;
		background: color-mix(in srgb, var(--on-surface) 10%, var(--surface));
		margin-bottom: 0.6em;
	}

	.panel-head {
		display: flex;
		align-items: flex-start;
		gap: 0.3em;
	}

	.menu-wrap {
		flex: 0 0 auto;
	}

	.panel-title {
		flex: 1;
		min-width: 0;
		font-family: var(--alternative-font);
		font-size: 1.15em;
		line-height: 1.15;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.panel-meta {
		font-size: 0.72em;
		opacity: 0.6;
		margin-bottom: 0.7em;
	}

	.panel-actions {
		display: flex;
		flex-direction: column;
		gap: 0.3em;
		font-size: 0.9em;
	}

	.action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4em;
		padding: 0 0.3em;
	}


	.runs {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3em;
	}

	.run {
		display: flex;
		align-items: center;
		gap: 0.7em;
		background: var(--surface);
		border: 1px solid var(--outline);
		border-radius: 0.5em;
		padding: 0.5em 0.6em;
		font-size: 0.8em;
		color: inherit;
		text-decoration: none;
	}

	.run:hover {
		background: var(--surface-variant);
	}

	.run-when {
		flex: 1;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.run-players {
		display: flex;
		align-items: center;
		gap: 0.25em;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}

	.run-bar {
		width: 6em;
		flex: 0 0 auto;
	}

	.run-acc {
		/* min- not a fixed width: "100%" needs ~4.4ch, so 3.5ch let the text spill
		   out of the box and sit on the row's padding. */
		min-width: 4.5ch;
		text-align: end;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.empty {
		border: 1px dashed var(--outline);
		border-radius: 0.6em;
		padding: 1.5em 1em;
		text-align: center;
	}

	.empty-title {
		font-weight: 700;
		font-size: 0.9em;
	}

	.empty-detail {
		font-size: 0.75em;
		opacity: 0.7;
		margin-top: 0.2em;
	}

	@media (max-width: 480px) {
		.run-bar {
			display: none;
		}
	}
</style>
