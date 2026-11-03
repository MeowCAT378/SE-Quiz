<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import type {
		GeneratedActivityDraft,
		ResolvedActivityGenerationRequest
	} from '$lib/ai/activityGeneration';
	import { fixTimes, limits, removeIds, shareAndCopyURL } from '$lib/clientOnly';
	import * as m from '$lib/paraglide/messages.js';
	import { lintConfigIssues } from '$lib/question-types/lint';
	import { lintIssueTopbarMessage } from '$lib/question-types/lintMessages';
	import { type Database, type ExportedFuiz, updateCreation, verifyAccount } from '$lib/storage';
	import SaveFeedback from '$lib/storage/SaveFeedback.svelte';
	import { guardUnsavedNavigation } from '$lib/storage/saveNavigation';
	import { createSaveQueue, type SaveState } from '$lib/storage/saveQueue';
	import type { Base64Media, GenericFuizConfig } from '$lib/types';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import AiActivityDialog from './AiActivityDialog.svelte';
	import { appendActivityDrafts, type PinDraftAttachment } from './aiActivitySlides';
	import Main from './Main.svelte';
	import Topbar from './Topbar.svelte';

	let {
		id = $bindable(),
		exportedFuiz = $bindable(),
		config = $bindable(),
		db,
		showPublish,
		showShare,
		aiAvailable = false
	}: {
		id: number;
		exportedFuiz: ExportedFuiz;
		config: GenericFuizConfig<Base64Media | undefined>;
		db: Database;
		showPublish?: boolean;
		showShare?: boolean;
		aiAvailable?: boolean;
	} = $props();

	let saveState = $state<SaveState>('saved');
	let saveError = $state<unknown>();
	let syncWarning = $state(false);
	let saveTimer: ReturnType<typeof setTimeout>;
	const saver = createSaveQueue(
		(snapshot: GenericFuizConfig<Base64Media | undefined>) => ({
			...$state.snapshot(exportedFuiz),
			versionId: exportedFuiz.versionId + 1,
			config: fixTimes(removeIds(snapshot)),
			lastEdited: Date.now()
		}),
		async (candidate) => {
			await updateCreation(id, candidate, db);
			exportedFuiz = candidate;
			syncWarning = !!db.syncWarning;
		},
		(state, cause) => {
			saveState = state;
			saveError = cause;
		}
	);
	let previous = untrack(() => JSON.stringify($state.snapshot(config)));
	$effect(() => {
		const snapshot = $state.snapshot(config);
		const serialized = JSON.stringify(snapshot);
		untrack(() => {
			if (serialized === previous) return;
			previous = serialized;
			saver.set(snapshot);
			clearTimeout(saveTimer);
			if (saveState !== 'error')
				saveTimer = setTimeout(() => {
					void flushSave();
				}, 500);
		});
	});
	onDestroy(() => clearTimeout(saveTimer));
	guardUnsavedNavigation(
		() => saveState !== 'saved',
		() => db.closed,
		flushSave
	);
	async function flushSave(): Promise<boolean> {
		clearTimeout(saveTimer);
		try {
			await verifyAccount(db);
			await saver.flush();
			return true;
		} catch (cause) {
			saveState = 'error';
			saveError = cause;
			return false;
		}
	}

	let issues = $derived(lintConfigIssues(config));
	let errorMessage = $derived(lintIssueTopbarMessage(issues[0]?.issue));
	let selectedSlideIndex = $state(0);
	async function goToIssue() {
		const first = issues[0];
		if (!first) return;
		selectedSlideIndex = first.slideIndex;
		await tick();
		const root = document.getElementById('slide-editor');
		let target: HTMLElement | null = null;
		if (first.issue === 'no_correct') target = root?.querySelector('[role="checkbox"]') ?? null;
		if (first.issue === 'empty_answer')
			target =
				Array.from(
					root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
						'.answers input, .answers textarea'
					) ?? []
				).find((input) => !input.value.length) ?? null;
		const selector =
			first.issue === 'correct_out_of_range'
				? '#slider_correct'
				: first.issue === 'empty_range'
					? '#slider_max, button[popovertarget="scale-max"]'
					: first.issue === 'no_entries'
						? 'button[popovertarget="free-text-entries"], button[popovertarget="brainstorm-ideas"]'
						: first.issue === 'empty_slide'
							? '#question_title'
							: '';
		if (selector) target = document.querySelector(selector);
		(target ?? root)?.focus({ preventScroll: true });
		(target ?? root)?.scrollIntoView({ block: 'center', behavior: 'instant' });
	}
	let aiDialog = $state<AiActivityDialog>();

	function addGenerated(
		request: ResolvedActivityGenerationRequest,
		drafts: GeneratedActivityDraft[],
		answerLabels?: [string, string],
		attachments?: PinDraftAttachment<Base64Media | undefined>[]
	) {
		config = appendActivityDrafts(config, request, drafts, answerLabels, attachments);
	}

	async function onShare(showCopied: () => void) {
		if (!(await flushSave())) return;
		try {
			await shareAndCopyURL(removeIds(config), db);
			showCopied();
		} catch (cause) {
			saveState = 'error';
			saveError = cause;
		}
	}
</script>

<div class="root">
	<Topbar
		bind:title={config.title}
		{id}
		{db}
		{showPublish}
		{showShare}
		onshare={onShare}
		onsave={flushSave}
		onerror={(cause) => { saveState = 'error'; saveError = cause; }}
		{errorMessage}
		ongenerate={() => aiDialog?.open()}
		{aiAvailable}
	/>
	{#if saveState !== 'saved' || syncWarning}
		<SaveFeedback state={saveState} error={saveError} warning={syncWarning} retry={() => { void flushSave(); }} />
	{/if}
	{#if issues[0]}
		<div class="validation" role="status" aria-live="polite">
			<p>{m.editor_issue({ slide: issues[0].slideIndex + 1, problem: errorMessage ?? '' })}
				{#if issues.length > 1} {m.editor_more_issues({ count: issues.length - 1 })}{/if}</p>
			<FancyButton variant="outline" onclick={() => { void goToIssue(); }}>{m.editor_go_to_issue()}</FancyButton>
		</div>
	{/if}
	<Main bind:config bind:selectedSlideIndex />
	<AiActivityDialog
		bind:this={aiDialog}
		{db}
		creationId={exportedFuiz.uniqueId}
		remainingSlides={limits.fuiz.maxSlidesCount - config.slides.length}
		onadd={addGenerated}
	/>
</div>

<style>
	.validation { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.6rem 1rem; border-bottom: 1px solid var(--outline); }
	.validation p { margin: 0; flex: 1 1 20rem; overflow-wrap: anywhere; }
	.root {
		min-height: 100dvh;
		background: var(--surface);
		display: flex;
		flex-direction: column;
	}
</style>
