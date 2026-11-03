<script lang="ts">
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import Dropdown from '$lib/admin/LlmDropdown.svelte';
	import {
		ACTIVITY_TYPES,
		type ActivityGenerationRequest,
		type ActivityType,
		type GeneratedActivityDraft,
		type GenerationLanguage,
		isScoredActivity,
		MAX_ACTIVITY_ITEMS,
		type ResolvedActivityGenerationRequest,
		type ResolvedGenerationLanguage,
		validateActivityDrafts,
		validateGenerationRequest
	} from '$lib/ai/activityGeneration';
	import { llmErrorMessage } from '$lib/ai/llmMessages';
	import { CONTENT_LANGUAGES } from '$lib/contentLanguages';
	import Modal from '$lib/feedback/Modal.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import {
		accountRequest,
		type Database,
		onAccountStorageCleared,
		StorageError
	} from '$lib/storage';
	import type { Base64Media } from '$lib/types';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';
	import Textfield from '$lib/ui/Textfield.svelte';
	import DeleteOutline from '~icons/material-symbols/delete-outline';
	import AiActivityDraft from './AiActivityDraft.svelte';
	import { type PinDraftAttachment, validPinImage, validPinTarget } from './aiActivitySlides';
	import { slideTemplates } from './slideTemplates';

	const templateKeys: Record<ActivityType, string> = {
		multiple_choice: 'quiz',
		true_false: 'true-false',
		short_answer: 'type-answer',
		slider: 'slider',
		ordering: 'puzzle',
		pin_answer: 'pin-answer',
		poll: 'poll',
		agreement_scale: 'scale',
		nps: 'nps',
		drop_pin: 'drop-pin',
		word_cloud: 'word-cloud',
		open_ended: 'open-ended',
		brainstorm: 'brainstorm'
	};
	const activityOptions = $derived(
		ACTIVITY_TYPES.map((value) => {
			const template = slideTemplates.find((candidate) => candidate.key === templateKeys[value]);
			if (!template) throw new Error('missing_slide_template');
			return { value, label: template.label(), icon: template.icon };
		})
	);

	type ReviewDraft = {
		id: string;
		content: GeneratedActivityDraft;
		attachment: PinDraftAttachment<Base64Media | undefined>;
	};

	let {
		db,
		creationId,
		remainingSlides,
		onadd
	}: {
		db: Database;
		creationId: string;
		remainingSlides: number;
		onadd: (
			request: ResolvedActivityGenerationRequest,
			drafts: GeneratedActivityDraft[],
			answerLabels?: [string, string],
			attachments?: PinDraftAttachment<Base64Media | undefined>[]
		) => void;
	} = $props();

	let modal = $state<Modal>();
	let activityType = $state<ActivityType>('multiple_choice');
	let topic = $state('');
	let instructions = $state('');
	let itemCount = $state(5);
	let language = $state<GenerationLanguage>('auto');
	let resolvedLanguage = $state<ResolvedGenerationLanguage>();
	let answerLabels = $state<[string, string]>();
	let choicesPerItem = $state<2 | 3 | 4>(4);
	let drafts = $state<ReviewDraft[]>([]);
	let errorMessage = $state('');
	let generating = $state(false);
	let operationId = $state<string>();
	let clientController: AbortController | undefined;
	let generation = 0;
	let settingsLocked = $derived(generating || drafts.length > 0);
	let maximumCount = $derived(Math.min(MAX_ACTIVITY_ITEMS, remainingSlides));
	let itemCountError = $derived(
		itemCount > MAX_ACTIVITY_ITEMS
			? m.ai_item_count_max({ count: MAX_ACTIVITY_ITEMS })
			: !Number.isInteger(itemCount) || itemCount < 1 || itemCount > maximumCount
				? m.ai_item_count_invalid({ count: maximumCount })
				: ''
	);
	let reviewError = $derived.by(() => {
		if (!drafts.length) return '';
		try {
			validateActivityDrafts(
				{ ...request(), itemCount: drafts.length },
				drafts.map((draft) => draft.content)
			);
			if (drafts.length > remainingSlides)
				return m.ai_item_count_invalid({ count: remainingSlides });
			if (activityType === 'pin_answer' || activityType === 'drop_pin') {
				if (drafts.some((draft) => !validPinImage(draft.attachment.media))) return m.no_media();
				if (
					activityType === 'pin_answer' &&
					drafts.some((draft) => !validPinTarget(draft.attachment.correctArea))
				)
					return m.ai_pin_target_required();
			}
			return '';
		} catch {
			return m.ai_review_error();
		}
	});

	export function open() {
		errorMessage = '';
		modal?.open();
	}

	function request(): ActivityGenerationRequest {
		return {
			activityType,
			topic,
			instructions,
			itemCount,
			language,
			...(language === 'auto'
				? { fallbackLanguage: getLocale() === 'th' ? ('th' as const) : ('en' as const) }
				: {}),
			...(isScoredActivity(activityType) ? { difficulty: 'mixed' as const } : {}),
			...(activityType === 'multiple_choice' || activityType === 'poll' ? { choicesPerItem } : {})
		};
	}

	function cancelServer(id: string) {
		void fetch(resolve('/api/ai/activities/cancel'), {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-seopen-account': db.user.id,
				'x-seopen-session': String(db.sessionIssuedAt)
			},
			body: JSON.stringify({ operationId: id }),
			keepalive: true
		}).catch(() => undefined);
	}

	function cancelActive() {
		generation++;
		clientController?.abort();
		clientController = undefined;
		if (operationId) cancelServer(operationId);
		operationId = undefined;
		generating = false;
	}

	const removeAccountListener = onAccountStorageCleared(close);
	onDestroy(() => {
		cancelActive();
		removeAccountListener();
	});

	function resetDialog() {
		cancelActive();
		drafts = [];
		resolvedLanguage = undefined;
		answerLabels = undefined;
	}

	function close() {
		resetDialog();
		modal?.close();
	}

	async function generate() {
		if (settingsLocked || db.closed) return;
		errorMessage = '';
		if (itemCountError) return;
		try {
			validateGenerationRequest(request());
		} catch {
			errorMessage = m.ai_generation_error();
			return;
		}
		generating = true;
		drafts = [];
		resolvedLanguage = undefined;
		answerLabels = undefined;
		const currentGeneration = ++generation;
		const id = crypto.randomUUID();
		operationId = id;
		clientController = new AbortController();
		try {
			const response = await accountRequest(db, '/api/ai/activities', {
				method: 'POST',
				signal: clientController.signal,
				body: JSON.stringify({ operationId: id, creationId, ...request() })
			});
			const result = (await response.json()) as {
				operationId: string;
				drafts: GeneratedActivityDraft[];
				resolvedLanguage: ResolvedGenerationLanguage;
				answerLabels?: [string, string];
			};
			if (currentGeneration !== generation || result.operationId !== id) return;
			if (!CONTENT_LANGUAGES.includes(result.resolvedLanguage)) throw new Error('invalid_response');
			resolvedLanguage = result.resolvedLanguage;
			answerLabels = result.answerLabels;
			drafts = validateActivityDrafts(request(), result.drafts).map((content) => ({
				id: crypto.randomUUID(),
				content,
				attachment: {}
			}));
		} catch (cause) {
			if (currentGeneration !== generation) return;
			errorMessage =
				cause instanceof StorageError && cause.code
					? llmErrorMessage(cause.code)
					: cause instanceof StorageError && cause.status === 409
						? m.ai_busy()
						: cause instanceof StorageError && cause.status === 503
							? m.editor_ai_unavailable()
							: m.ai_generation_error();
		} finally {
			if (currentGeneration === generation) {
				generating = false;
				operationId = undefined;
				clientController = undefined;
			}
		}
	}

	function add() {
		errorMessage = '';
		if (db.closed || reviewError || !drafts.length) return;
		try {
			if (!resolvedLanguage) throw new Error('invalid_response');
			onadd(
				{ ...request(), language: resolvedLanguage },
				$state.snapshot(drafts.map((draft) => draft.content)),
				answerLabels,
				$state.snapshot(drafts.map((draft) => draft.attachment))
			);
			drafts = [];
			modal?.close();
		} catch {
			errorMessage = m.ai_generation_error();
		}
	}
</script>

<Modal
	bind:this={modal}
	width="min(70ch, calc(100vw - 2em))"
	ariaLabelledby="ai-dialog-title"
	onclose={resetDialog}
>
	<h2 id="ai-dialog-title">{m.ai_generate()}</h2>
	<form onsubmit={(event) => { event.preventDefault(); void generate(); }}>
		<div class="select-field">
			<Dropdown id="ai-activity-type" label={m.ai_activity_type()} value={activityType} options={activityOptions} disabled={settingsLocked} onselect={(value) => activityType = value as ActivityType} />
		</div>
		<Textfield id="ai-topic" placeholder={m.ai_topic()} required={true} disabled={settingsLocked} bind:value={topic} maxLength={300} />
		<Textarea
			id="ai-instructions"
			placeholder={m.ai_instructions()}
			required={false}
			disabled={settingsLocked}
			bind:value={instructions}
			minHeight="5em"
			maxHeight="12em"
			multiline
			resize="vertical"
			maxLength={2000}
		/>
		<div class="row">
			<div class="count-field"><label for="ai-item-count">{m.ai_item_count()}</label><input id="ai-item-count" type="number" min="1" max={maximumCount} step="1" required bind:value={itemCount} disabled={settingsLocked} aria-invalid={!!itemCountError} aria-describedby={itemCountError ? 'ai-item-count-hint ai-item-count-error' : 'ai-item-count-hint'} /><p id="ai-item-count-hint" class="hint">{m.ai_item_count_max({ count: MAX_ACTIVITY_ITEMS })}</p></div>
			<div class="select-field">
				<Dropdown id="ai-language" label={m.language()} value={language} options={[
					{ value: 'auto', label: m.ai_auto_detect() },
					{ value: 'th', label: 'ไทย' },
					{ value: 'en', label: 'English' }
				]} disabled={settingsLocked} onselect={(value) => language = value as GenerationLanguage} />
			</div>
			{#if activityType === 'multiple_choice' || activityType === 'poll'}
				<div class="select-field">
					<Dropdown id="ai-choice-count" label={m.ai_choice_count()} value={String(choicesPerItem)} options={[2, 3, 4].map((value) => ({ value: String(value), label: String(value) }))} disabled={settingsLocked} onselect={(value) => choicesPerItem = Number(value) as 2 | 3 | 4} />
				</div>
			{/if}
		</div>
		<div class="actions">
			<FancyButton type="button" variant="outline" onclick={close}>{m.cancel()}</FancyButton>
			<FancyButton type="submit" disabled={settingsLocked || !!itemCountError}
				>{generating ? m.ai_generating() : m.ai_generate()}</FancyButton
			>
		</div>
	</form>
	{#if itemCountError}<p id="ai-item-count-error" class="error" role="alert">{itemCountError}</p>{/if}
	{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}
	{#if drafts.length}
		<p class="warning">{m.ai_review_warning()}</p>
		{#if activityType === 'true_false' && answerLabels}
			<div class="answer-labels">
				<label>{m.answer_true()}<input bind:value={answerLabels[0]} maxlength="500" /></label>
				<label>{m.answer_false()}<input bind:value={answerLabels[1]} maxlength="500" /></label>
			</div>
		{/if}
		<div class="drafts">
			{#each drafts as draft, index (draft.id)}
				<fieldset>
					<legend>{index + 1}</legend>
					<AiActivityDraft id={draft.id} {activityType} bind:draft={draft.content} bind:attachment={draft.attachment} />
					<div class="remove-action">
						<FancyButton type="button" variant="outline" onclick={() => drafts.splice(index, 1)}>
							<span class="remove-label"><DeleteOutline aria-hidden="true" />{m.remove()}</span>
						</FancyButton>
					</div>
				</fieldset>
			{/each}
		</div>
		{#if reviewError}<p class="error" role="alert">{reviewError}</p>{/if}
		<div class="actions"><FancyButton disabled={!drafts.length || !!reviewError} onclick={add}>{m.ai_add_to_activity()}</FancyButton></div>
	{/if}
</Modal>

<style>
	h2 {
		margin: 0 0 0.9rem;
		font-family: var(--alternative-font);
	}

	form,
	.drafts,
	fieldset {
		display: grid;
		gap: 0.9rem;
	}

	.row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		align-items: start;
	}

	.count-field { display: grid; gap: 0.4rem; min-width: 0; }
	.count-field input { font-size: 0.9em; }
	.hint { margin: 0; font-size: 0.8em; color: var(--on-surface-variant); }
	input:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

	.select-field {
		min-width: 0;
		font-size: 0.9em;
	}

	.select-field :global(.trigger) {
		min-height: 2.75em;
		border-radius: 0.5em;
	}

	.answer-labels {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	label {
		display: grid;
		gap: 0.4em;
		font-size: 0.9em;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		min-height: 2.75em;
		padding: 0.55em;
		border: 1px solid var(--outline);
		border-radius: 0.5em;
		background: var(--surface);
		color: inherit;
		font: inherit;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: stretch;
		gap: 0.6rem;
		margin-top: 0.35rem;
	}

	.warning {
		padding: 0.6em;
		border-radius: 0.5em;
		background: color-mix(in srgb, var(--primary) 10%, transparent);
	}

	.error {
		color: var(--primary);
	}

	.remove-action {
		justify-self: end;
	}

	.remove-label {
		display: flex;
		align-items: center;
		gap: 0.35em;
	}

	.remove-label :global(svg) {
		width: 1.1em;
		height: 1.1em;
	}

	fieldset {
		min-width: 0;
		border: 1px solid var(--outline);
		border-radius: 0.6em;
	}

	@media (max-width: 64em) {
		.row {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 40em) {
		.row {
			grid-template-columns: minmax(0, 1fr);
		}

		.answer-labels {
			grid-template-columns: minmax(0, 1fr);
		}

		.actions {
			flex-direction: column;
		}

		.actions :global(button) {
			width: 100%;
		}
	}
</style>
