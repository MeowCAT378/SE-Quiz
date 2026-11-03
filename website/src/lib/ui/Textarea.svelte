<script lang="ts">
	let {
		id,
		placeholder,
		required,
		disabled,
		value = $bindable(),
		maxHeight = '4em',
		minHeight = undefined,
		multiline = false,
		resize = 'none',
		maxLength = undefined
	}: {
		id: string;
		placeholder: string;
		required: boolean;
		disabled: boolean;
		value?: string;
		maxHeight?: string;
		minHeight?: string;
		multiline?: boolean;
		resize?: 'none' | 'vertical';
		maxLength?: number;
	} = $props();

	let editableElement = $state<HTMLTextAreaElement>();

	function resizeToContent() {
		if (!editableElement || (typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')))
			return;
		editableElement.style.height = 'auto';
		editableElement.style.height = `${editableElement.scrollHeight}px`;
	}

	$effect(() => {
		value;
		resizeToContent();
	});

	const onInput: import('svelte/elements').FormEventHandler<HTMLTextAreaElement> = (e) => {
		/* @ts-expect-error target will be HTMLTextAreaElement, the type system doesn't know */
		const target: HTMLTextAreaElement | null = e?.target ?? null;
		const inputtedValue = target?.value;
		value = multiline
			? inputtedValue
			: (inputtedValue?.replaceAll('\n', '').replaceAll('\r', '') ?? value);
		resizeToContent();
	};
</script>

<div class="field">
	<label for={id}>{placeholder}</label>
	<textarea
		style:--max-h={maxHeight}
		style:--min-h={minHeight ?? 'auto'}
		style:--resize={resize}
		bind:this={editableElement}
		{id}
		name={id}
		{required}
		{disabled}
		oninput={onInput}
		{value}
		placeholder=""
		maxlength={maxLength}
	></textarea>
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

	textarea {
		background: var(--surface);
		font: inherit;
		font-weight: bold;
		border: 1px solid var(--outline);
		border-radius: 10px;
		width: 100%;
		height: auto;
		min-height: var(--min-h);
		max-height: var(--max-h);
		color: inherit;
		box-sizing: border-box;
		text-align: start;
		padding: 0.65em 0.75em;
		field-sizing: content;
		overflow-y: auto;
		resize: var(--resize);
		transition: border-color 100ms linear;
	}

	textarea:focus {
		outline: 3px solid color-mix(in srgb, var(--primary) 35%, transparent);
		outline-offset: 2px;
		border-color: var(--primary);
	}

	textarea:disabled {
		cursor: not-allowed;
		opacity: 0.65;
		background: var(--surface-variant);
	}
</style>
