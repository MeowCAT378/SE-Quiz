<script lang="ts">
	import type { ActivityType, GeneratedActivityDraft } from '$lib/ai/activityGeneration';
	import PinBoard from '$lib/game/PinBoard.svelte';
	import { limits } from '$lib/limits';
	import MediaChooser from '$lib/media/MediaChooser.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import type { Base64Media, PinShape } from '$lib/types';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import ArrowDownward from '~icons/material-symbols/arrow-downward';
	import ArrowUpward from '~icons/material-symbols/arrow-upward';
	import DeleteOutline from '~icons/material-symbols/delete-outline';
	import type { PinDraftAttachment } from './aiActivitySlides';

	let {
		id,
		activityType,
		draft = $bindable(),
		attachment = $bindable()
	}: {
		id: string;
		activityType: ActivityType;
		draft: GeneratedActivityDraft;
		attachment: PinDraftAttachment<Base64Media | undefined>;
	} = $props();

	let rectangle = $derived(
		attachment.correctArea && 'Rectangle' in attachment.correctArea
			? attachment.correctArea.Rectangle
			: undefined
	);
	const targetFields = [
		{ key: 'x', label: m.pin_target_x },
		{ key: 'y', label: m.pin_target_y },
		{ key: 'width', label: m.pin_target_width },
		{ key: 'height', label: m.pin_target_height }
	] as const;

	function setTarget(key: 'x' | 'y' | 'width' | 'height', value: number) {
		attachment.correctArea = {
			Rectangle: { x: 0, y: 0, width: 0, height: 0, ...rectangle, [key]: value / 100 }
		};
	}

	function draw(shape: PinShape) {
		if (!('Rectangle' in shape)) return;
		const { x, y, width, height } = shape.Rectangle;
		attachment.correctArea = {
			Rectangle: {
				x: Math.min(x, x + width),
				y: Math.min(y, y + height),
				width: Math.abs(width),
				height: Math.abs(height)
			}
		};
	}

	function move(items: string[], index: number, direction: -1 | 1) {
		[items[index], items[index + direction]] = [items[index + direction], items[index]];
	}
</script>

{#if 'question' in draft}
	<label>{m.question_text()}<input bind:value={draft.question} maxlength={limits.fuiz.maxTitleLength} required /></label>
{:else if 'statement' in draft}
	<label>{m.question_text()}<input bind:value={draft.statement} maxlength={limits.fuiz.maxTitleLength} required /></label>
{:else}
	<label>{m.question_text()}<input bind:value={draft.prompt} maxlength={limits.fuiz.maxTitleLength} required /></label>
{/if}

{#if 'choices' in draft}
	{#each draft.choices as _, index (index)}
		<div class="choice">
			<label>{m.answer_text()} {index + 1}<input bind:value={draft.choices[index]} maxlength={limits.fuiz.maxAnswerTextLength} required /></label>
			{#if 'correctIndex' in draft}
				<input type="radio" name="correct-{id}" checked={draft.correctIndex === index} onchange={() => { if ('correctIndex' in draft) draft.correctIndex = index; }} aria-label={`${m.correct_answer()} ${index + 1}`} />
			{/if}
		</div>
	{/each}
{:else if 'statement' in draft}
	<label class="boolean"><input type="checkbox" bind:checked={draft.correct} />{m.answer_true()}</label>
{:else if 'answers' in draft || 'items' in draft}
	{@const answers = 'answers' in draft ? draft.answers : draft.items}
	{@const ordered = 'items' in draft}
	{@const minimum = ordered ? 2 : 1}
	{@const maximum = ordered ? limits.fuiz.order.maxAnswerCount : limits.fuiz.typeAnswer.maxAnswerCount}
	{#each answers as _, index (index)}
		<div class="answer-row">
			<label>{m.answer_text()} {index + 1}<input bind:value={answers[index]} maxlength={limits.fuiz.maxAnswerTextLength} required /></label>
			<div class="answer-actions">
				{#if ordered}
					<button type="button" disabled={index === 0} onclick={() => move(answers, index, -1)} aria-label={m.move_up()} title={m.move_up()}><ArrowUpward /></button>
					<button type="button" disabled={index === answers.length - 1} onclick={() => move(answers, index, 1)} aria-label={m.move_down()} title={m.move_down()}><ArrowDownward /></button>
				{/if}
				<button type="button" disabled={answers.length <= minimum} onclick={() => answers.splice(index, 1)} aria-label={m.delete_answer()} title={m.delete_answer()}><DeleteOutline /></button>
			</div>
		</div>
	{/each}
	<div><FancyButton type="button" variant="outline" disabled={answers.length >= maximum} onclick={() => answers.push('')}>{m.add_answer()}</FancyButton></div>
{:else if 'range' in draft}
	<div class="fields">
		<label>{m.minimum()}<input type="number" step="any" bind:value={draft.range.min} required /></label>
		<label>{m.maximum()}<input type="number" step="any" bind:value={draft.range.max} required /></label>
		<label>{m.step_size()}<input type="number" step="any" min="0" bind:value={draft.range.step} required /></label>
		<label>{m.correct_answer()}<input type="number" step="any" bind:value={draft.correct} required /></label>
		<label>{m.tolerance()}<input type="number" step="any" min="0" bind:value={draft.tolerance} required /></label>
		<label>{m.unit()}<input bind:value={draft.unit} maxlength={limits.fuiz.slider.maxUnitLength} /></label>
	</div>
{:else if 'labels' in draft}
	<p class="hint">{m.range_label({ from: activityType === 'nps' ? limits.fuiz.scale.npsMin : 1, to: activityType === 'nps' ? limits.fuiz.scale.npsMax : limits.fuiz.scale.defaultAgreementMax })}</p>
	<label>{m.label_low()}<input bind:value={draft.labels.low} maxlength={limits.fuiz.scale.maxLabelLength} required /></label>
	<label>{m.label_mid()}<input bind:value={draft.labels.mid} maxlength={limits.fuiz.scale.maxLabelLength} required /></label>
	<label>{m.label_high()}<input bind:value={draft.labels.high} maxlength={limits.fuiz.scale.maxLabelLength} required /></label>
{/if}

{#if activityType === 'pin_answer' || activityType === 'drop_pin'}
	<p class="hint">{m.ai_teacher_image_hint()}</p>
	<MediaChooser bind:media={() => attachment.media, (media) => { attachment.media = media && 'Base64' in media.Image ? media as Base64Media : undefined; }} onchange={() => { attachment.correctArea = undefined; }} />
	{#if attachment.media}
		<div class="board">
			<PinBoard media={attachment.media} shape={attachment.correctArea} showShape tool={activityType === 'pin_answer' ? 'Rectangle' : undefined} ondraw={draw} />
		</div>
		{#if activityType === 'pin_answer'}
			<p class="hint">{m.pin_draw_hint({ tool: m.tool_rectangle() })}</p>
			<div class="fields" role="group" aria-label={m.correct_area()}>
				{#each targetFields as field (field.key)}
					<label>{field.label()}<input type="number" min="0" max="100" step="any" data-target-field={field.key} value={rectangle && Number.isFinite(rectangle[field.key]) ? rectangle[field.key] * 100 : ''} oninput={(event) => setTarget(field.key, event.currentTarget.valueAsNumber)} required /></label>
				{/each}
			</div>
		{:else}<p class="hint">{m.drop_pin_hint()}</p>{/if}
	{/if}
{/if}

<style>
	label { display: grid; gap: 0.4em; min-width: 0; font-size: 0.9em; }
	input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 2.75em; padding: 0.55em; border: 1px solid var(--outline); border-radius: 0.5em; background: var(--surface); color: inherit; font: inherit; }
	input:focus-visible, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
	.choice { display: flex; align-items: center; gap: 0.5em; }
	.choice label { flex: 1; }
	.choice input[type='radio'], .boolean input { width: 1.5em; }
	.boolean { display: flex; align-items: center; }
	.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
	.answer-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 0.5em; }
	.answer-row label { flex: 1 1 12em; }
	.answer-actions { display: flex; gap: 0.3em; }
	.answer-actions button { display: grid; place-items: center; width: 2.75em; height: 2.75em; border: 1px solid var(--outline); border-radius: 0.4em; background: var(--surface); color: inherit; cursor: pointer; }
	.answer-actions button:disabled { opacity: 0.4; cursor: default; }
	.board { height: 15em; max-height: 45vh; min-width: 0; }
	.hint { margin: 0; font-size: 0.85em; color: var(--on-surface-variant); }
</style>
