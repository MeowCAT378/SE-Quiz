<script lang="ts">
	import { limits } from '$lib/clientOnly';
	import * as m from '$lib/paraglide/messages.js';
	import type { TextOrMedia } from '$lib/types';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Textbox from '$lib/ui/Textbox.svelte';
	import DeleteOutline from '~icons/material-symbols/delete-outline';

	let {
		correct = $bindable(),
		content = $bindable(),
		index,
		attention = false,
		onclick
	}: {
		correct: boolean;
		content: TextOrMedia;
		index: number;
		attention?: boolean;
		onclick?: () => void;
	} = $props();
</script>

<FancyButton palette={index} active={false} fill height="100%">
	<div class="row">
		<div class="check-cell">
			<Checkbox {attention} bind:value={correct} />
		</div>
		<Textbox
			bind:value={content.Text}
			placeholder={m.answer_text()}
			textAlign="start"
			lightText
			maxLength={limits.fuiz.maxAnswerTextLength}
		/>
		<div class="delete-cell">
			<IconButton alt={m.delete_answer()} padding="0.25em" {onclick}>
				<DeleteOutline height="1.25em" />
			</IconButton>
		</div>
	</div>
</FancyButton>

<style>
	.row {
		display: grid;
		grid-template-columns: 1.8em minmax(0, 1fr) 1.8em;
		align-items: center;
		min-height: 4.4em;
		height: 100%;
		padding: 0.4em 0.5em;
		gap: 0.5em;
		color: var(--palette-light);
		box-sizing: border-box;
	}

	.check-cell,
	.delete-cell {
		height: 1.8em;
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
