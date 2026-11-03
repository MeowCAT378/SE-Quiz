<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import {
		addCreation,
		type Database,
		type ExportedFuiz,
		generateUuid,
		loadDatabase
	} from '$lib/storage';
	import { storageErrorMessage } from '$lib/storage/feedback';
	import FancyButton from '$lib/ui/FancyButton.svelte';

	let { data } = $props();
	let busy = $state(false);
	let error = $state('');
	let database: Database | undefined;
	let source = $derived(`${page.params.id ?? ''}:${JSON.stringify(data.fuiz)}`);
	let candidate: ExportedFuiz | undefined;
	let candidateSource: string | undefined;
	async function importQuiz() {
		const importingSource = source;
		if (candidateSource !== importingSource) {
			candidateSource = importingSource;
			candidate = {
				lastEdited: Date.now(),
				uniqueId: generateUuid(),
				versionId: 0,
				config: $state.snapshot(data.fuiz)
			};
		}
		const attempt = candidate!;
		busy = true;
		error = '';
		try {
			database ??= await loadDatabase();
			const id = await addCreation(attempt, database);
			if (source === importingSource) await goto(resolve(localizeHref(`/quiz/${id}/edit`)));
		} catch (cause) {
			error = storageErrorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>
<svelte:head><title>{data.fuiz.title}</title></svelte:head>
<TypicalPage><main>
	<h1>{data.fuiz.title}</h1><p>{m.slides_count({ count: data.fuiz.slides.length })}</p>
	{#if data.user}<FancyButton onclick={importQuiz} disabled={busy}>{m.import_fuiz()}</FancyButton>
	{:else}<a href={resolve(localizeHref(`/login?returnTo=${encodeURIComponent(page.url.pathname)}`))}>{m.share_import_login()}</a>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
</main></TypicalPage>
<style>main { max-width: 40em; margin: 2em auto; padding: 1em; }</style>
