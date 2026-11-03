<script lang="ts">
	import type { FullAutoFill } from 'svelte/elements';
	import * as m from '$lib/paraglide/messages.js';

	import ErrorOutline from '~icons/material-symbols/error-outline';

	let {
		id,
		type = 'text',
		placeholder,
		label = undefined,
		required,
		disabled,
		value = $bindable(),
		textTransform = '',
		autocomplete = 'off',
		maxLength = undefined,
		minLength = undefined,
		showInvalid = true,
		inputmode = undefined,
		invalidMessage = m.field_required(),
		ariaDescribedby = undefined
	}: {
		id: string;
		type?: 'text' | 'email' | 'password';
		placeholder: string;
		label?: string;
		required: boolean;
		disabled: boolean;
		value: string | undefined;
		textTransform?: string;
		autocomplete?: FullAutoFill | null;
		maxLength?: number;
		minLength?: number;
		showInvalid?: boolean;
		inputmode?: 'text' | 'search' | 'none' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal';
		invalidMessage?: string;
		ariaDescribedby?: string;
	} = $props();

	let inputElement = $state<HTMLInputElement>();
	let invalid = $state(false);
	let invalidId = $derived(`${id}-invalid`);
	let describedBy = $derived(
		[ariaDescribedby, invalid ? invalidId : undefined].filter(Boolean).join(' ') || undefined
	);

	function updateValidity(element = inputElement) {
		invalid = showInvalid && !!element && !element.validity.valid;
	}

	$effect(() => {
		value;
		required;
		disabled;
		minLength;
		maxLength;
		updateValidity();
	});
</script>

<div class="field">
	<label for={id}>{label ?? placeholder}</label>
	<div class="control">
		<input
			bind:this={inputElement}
			class={showInvalid ? 'show-invalid' : ''}
			{id}
			name={id}
			{autocomplete}
			{type}
			style:--tt={textTransform}
			{required}
			{disabled}
			placeholder={label ? placeholder : ''}
			bind:value
			maxlength={maxLength}
			minlength={minLength}
			{inputmode}
			aria-invalid={invalid ? 'true' : undefined}
			aria-describedby={describedBy}
			oninvalid={(event) => {
				event.currentTarget.setCustomValidity(invalidMessage);
				updateValidity(event.currentTarget);
			}}
			oninput={(event) => {
				event.currentTarget.setCustomValidity('');
				updateValidity(event.currentTarget);
			}}
		/>
		<div class="error-icon" aria-hidden="true">
			<ErrorOutline height="1.2em" title={m.length_too_short()} />
		</div>
	</div>
	{#if invalid}<span id={invalidId} class="visually-hidden">{invalidMessage}</span>{/if}
</div>

<style>
	.field {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.4em;
	}

	label {
		font-weight: 600;
		line-height: 1.25;
	}

	.control {
		position: relative;
	}

	.error-icon {
		display: none;
	}

	input.show-invalid:invalid {
		padding-inline-end: 2.6em;

		& ~ .error-icon {
			color: var(--primary);
			display: flex;
			align-items: center;
			position: absolute;
			inset-block: 0;
			inset-inline-end: 0.75em;
			pointer-events: none;
		}
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	input {
		background: var(--surface);
		border: 1px solid var(--outline);
		border-radius: 0.7em;
		width: 100%;
		color: inherit;
		box-sizing: border-box;
		font: inherit;
		text-align: start;
		text-transform: var(--tt);
		padding: 0.65em 0.75em;
		resize: none;
		transition: border-color 100ms linear;
	}

	input:focus {
		outline: 3px solid color-mix(in srgb, var(--primary) 35%, transparent);
		outline-offset: 2px;
		border-color: var(--primary);
	}

	input:disabled {
		cursor: not-allowed;
		opacity: 0.65;
		background: var(--surface-variant);
	}

	input::placeholder {
		color: var(--on-surface-variant);
		opacity: 1;
		white-space: nowrap;
	}
</style>
