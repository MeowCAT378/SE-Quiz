<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import type { PublicAccount } from '$lib/server/accounts';
	import { accountRequest, type Database, loadDatabase, verifyAccount } from '$lib/storage';
	import { storageErrorMessage } from '$lib/storage/feedback';
	import {
		type LegacyPreview,
		prepareLegacyPreview,
		readLegacyBrowser,
		referencedLegacyMedia,
		selectedLegacyImport
	} from '$lib/storage/legacy';
	import FancyButton from '$lib/ui/FancyButton.svelte';

	let { data }: { data: { users: PublicAccount[]; currentUserId: string } } = $props();
	let source = $state<'IndexedDB' | 'legacyGoogleDrive'>('IndexedDB');
	let preview = $state<LegacyPreview>();
	let selected = $state<number[]>([]);
	let targetId = $state(untrack(() => data.currentUserId));
	let copy = $state(false);
	let busy = $state(false);
	let nextOffset = $state<number | null>(null);
	let message = $state('');
	let database: Database | undefined;
	let confirmation = $state<ConfirmationDialog>();
	const label = (record: Record<string, unknown>) =>
		String((record.config as { title?: string } | undefined)?.title ?? record.title ?? '');
	function questions(record: Record<string, unknown>): string[] {
		const slides = (record.config as { slides?: unknown[] } | undefined)?.slides;
		if (Array.isArray(slides))
			return slides.map((slide) =>
				String(Object.values(slide as Record<string, { title?: string }>)[0]?.title ?? '')
			);
		return Array.isArray(record.questions)
			? record.questions.map((question) => String(question.title ?? ''))
			: [];
	}
	function missing(index: number) {
		return [...referencedLegacyMedia(preview?.records[index].record)].some(
			(hash) => !preview?.media.some((item) => item.id === hash)
		);
	}
	async function read(offset = 0) {
		busy = true;
		message = '';
		preview = undefined;
		selected = [];
		try {
			database ??= await loadDatabase();
			await verifyAccount(database);
			if (database.user.role !== 'ADMIN') throw new Error(m.admin());
			const result =
				source === 'IndexedDB'
					? await readLegacyBrowser()
					: await (await accountRequest(database, `/api/gdrive/legacy?offset=${offset}`)).json();
			await verifyAccount(database);
			preview = prepareLegacyPreview(result);
			nextOffset = result.nextOffset ?? null;
		} catch (cause) {
			message = storageErrorMessage(cause);
		} finally {
			busy = false;
		}
	}
	async function importSelected() {
		if (!preview || !database || busy) return;
		busy = true;
		message = '';
		try {
			const selection = selectedLegacyImport($state.snapshot(preview), selected, copy);
			const result = await (
				await accountRequest(database, '/api/admin/import', {
					method: 'POST',
					body: JSON.stringify({ sourceKind: source, targetId, confirmed: true, ...selection })
				})
			).json();
			message = m.legacy_imported({ count: result.imports.length });
		} catch (cause) {
			message = storageErrorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>
<svelte:head><title>{m.legacy_import()}</title></svelte:head>
<TypicalPage><main>
	<h1>{m.legacy_import()}</h1><p>{m.legacy_limit()}</p>
	<label>{m.legacy_source()} <select bind:value={source} disabled={busy} onchange={() => { preview = undefined; selected = []; }}><option value="IndexedDB">{m.legacy_browser()}</option><option value="legacyGoogleDrive">{m.legacy_drive()}</option></select></label>
	{#if source === 'legacyGoogleDrive'}<a href={resolve(`/api/gdrive/login?legacy=1&return=${encodeURIComponent(page.url.pathname)}`)}>{m.legacy_connect()}</a>{/if}
	<FancyButton onclick={() => read()} disabled={busy}>{m.legacy_preview()}</FancyButton>
	{#if preview}
		{#if !preview.records.length}<p>{m.legacy_empty()}</p>{/if}
		{#each preview.records as item, index (index)}
			<section><label><input type="checkbox" bind:group={selected} value={index} disabled={busy || missing(index)} /> {item.kind === 'creation' ? m.create_title() : m.reports()}: {label(item.record)}</label>
				<details><summary>{m.legacy_preview()}</summary><ol>{#each questions(item.record) as question, questionIndex (questionIndex)}<li>{question}</li>{/each}</ol>{#if item.kind === 'report'}<p>{m.number_of_players()}: {String(item.record.playerCount ?? 0)}</p><p>{m.legacy_unavailable_origin()}</p>{/if}
					{#each [...referencedLegacyMedia(item.record)] as hash (hash)}<p>{hash}</p>{#each preview.media.filter((media) => media.id === hash) as media, mediaIndex (mediaIndex)}{#if typeof (media.media as any)?.Image?.Base64?.data === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test((media.media as any).Image.Base64.data)}<img src={(media.media as any).Image.Base64.data} alt={(media.media as any).Image.Base64.alt ?? ''} />{/if}{/each}{/each}
				</details>{#if missing(index)}<p>{m.legacy_missing_media()}</p>{/if}
			</section>
		{/each}
		{#if source === 'legacyGoogleDrive' && nextOffset !== null}<FancyButton disabled={busy} onclick={() => read(nextOffset!)}>{m.next()}</FancyButton>{/if}
		<label>{m.legacy_target()} <select bind:value={targetId} disabled={busy}>{#each data.users.filter((user) => !user.deletedAt) as user (user.id)}<option value={user.id}>{user.email}</option>{/each}</select></label>
		<label><input type="checkbox" bind:checked={copy} disabled={busy} /> {m.legacy_copy()}</label>
		<FancyButton disabled={busy || !selected.length || selected.length > 100} onclick={() => confirmation?.open()}>{m.legacy_confirm()}</FancyButton>
	{/if}
	{#if message}<p role="status">{message}</p>{/if}
</main></TypicalPage>
<ConfirmationDialog bind:this={confirmation} title={m.legacy_confirm()} message={`${m.legacy_confirm_detail()} ${data.users.find((user) => user.id === targetId)?.email ?? ''}`} confirmText={m.legacy_confirm()} onConfirm={importSelected} />
<style>main { max-width: 60em; margin: auto; padding: 1em; display: flex; flex-direction: column; gap: 1em; } section { border-bottom: 1px solid var(--outline); padding: .6em; } ol { max-height: 20em; overflow: auto; } img { max-width: 12em; max-height: 8em; } select { font: inherit; max-width: 100%; }</style>
