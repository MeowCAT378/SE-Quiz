<script lang="ts">
	import { flip } from 'svelte/animate';
	import { backOut } from 'svelte/easing';
	import { scale } from 'svelte/transition';
	import { limits } from '$lib/clientOnly';
	import * as m from '$lib/paraglide/messages.js';
	import type { MultipleChoiceAnswer } from '$lib/types';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import VariableAddOutline from '~icons/material-symbols/variable-add-outline';
	import Answer from './Answer.svelte';

	let {
		answers = $bindable()
	}: {
		answers: MultipleChoiceAnswer[];
	} = $props();
</script>

<div class="answers">
	<div class="grid">
		{#each answers as answer, index (answer.id)}
			<div
				class="answer-slot"
				transition:scale={{ easing: backOut, duration: 300 }}
				animate:flip={{ duration: 300 }}
			>
				<Answer
					attention={answers.filter((a) => a.correct).length == 0}
					bind:content={answers[index].content}
					bind:correct={answers[index].correct}
					{index}
					onclick={() => {
						answers.splice(index, 1);
						answers = answers;
					}}
				/>
			</div>
		{/each}
	</div>
	{#if answers.length < limits.fuiz.multipleChoice.maxAnswerCount}
		<div transition:scale={{ easing: backOut, duration: 300 }}>
			<FancyButton
				palette={answers.length}
				onclick={() => {
					answers.push({
						correct: false,
						content: {
							Text: ''
						},
						id: Date.now()
					});
					answers = answers;
				}}
			>
				<div class="add-label">
					<VariableAddOutline height="1.25em" title={m.add_answer()} />
					<div>{m.add_answer()}</div>
				</div>
			</FancyButton>
		</div>
	{/if}
</div>

<style>
	.answers {
		display: flex;
		flex-direction: column;
		gap: 0.7em;
		width: min(100%, 48em);
		margin-inline: auto;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: stretch;
		align-content: start;
		column-gap: 1em;
		row-gap: 0.7em;
		width: 100%;
	}

	.answer-slot {
		display: flex;
		min-width: 0;
	}

	.add-label {
		height: 100%;
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.2em 0.6em;
		gap: 0.2em;
		box-sizing: border-box;
	}

	@container (max-width: 42em) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
