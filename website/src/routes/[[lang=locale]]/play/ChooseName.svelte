<script lang="ts">
	import ErrorMessage from '$lib/feedback/ErrorMessage.svelte';
	import LoadingCircle from '$lib/feedback/LoadingCircle.svelte';
	import Modal from '$lib/feedback/Modal.svelte';
	import Avatar from '$lib/game/Avatar.svelte';
	import { avatars, defaultAvatar } from '$lib/game/avatars';
	import Footer from '$lib/layout/Footer.svelte';
	import Header from '$lib/layout/Header.svelte';
	import NiceBackground from '$lib/layout/NiceBackground.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import Textfield from '$lib/ui/Textfield.svelte';
	import Close from '~icons/material-symbols/close';
	import Edit from '~icons/material-symbols/edit-outline';

	let placeholder = m.nickname();
	let {
		sending,
		errorMessage = '',
		setName,
		name = $bindable(''),
		avatar = defaultAvatar,
		onavatar
	}: {
		sending: boolean;
		errorMessage?: string;
		setName: (name: string) => void;
		name?: string;
		avatar?: string;
		onavatar: (avatar: string) => void;
	} = $props();
	let picker: Modal;
	let changeButton: HTMLButtonElement;
	let waveSelection = $state(0);

	function openPicker() {
		picker.open();
	}

	function chooseAvatar(id: string) {
		onavatar(id);
		picker.close();
		waveSelection += 1;
	}

	function submit() {
		setName(name);
	}
</script>

<NiceBackground>
	<div class="page">
		<header>
			<Header />
		</header>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<div class="avatar-preview">
				<button class="avatar-trigger" type="button" aria-label={m.avatar_change()} bind:this={changeButton} onclick={openPicker} disabled={sending}>
					<span class="avatar-image">{#key waveSelection}<Avatar id={avatar} size={128} blink breathe swayHair wave={waveSelection > 0} />{/key}<span class="edit-badge" aria-hidden="true"><Edit height="1.1em" /></span></span>
				</button>
			</div>
			<ErrorMessage {errorMessage} />
			<Textfield
				id="name"
				{placeholder}
				autocomplete="nickname"
				required={true}
				showInvalid={false}
				disabled={sending}
				bind:value={name}
			/>
			<div class="submit">
				<FancyButton disabled={sending}>
					<div class="submit-label">
						{#if sending}
							<div class="loading">
								<LoadingCircle borderWidth={3} />
							</div>
						{/if}
						{m.lets_start()}
					</div>
				</FancyButton>
			</div>
		</form>
		<Modal bind:this={picker} width="min(38rem, calc(100vw - 1rem))" ariaLabelledby="avatar-picker-title" onclose={() => changeButton?.focus()}>
			<div class="picker-heading">
				<h2 id="avatar-picker-title">{m.avatar_choose()}</h2>
				<button class="picker-close" type="button" aria-label={m.cancel()} onclick={() => picker.close()}><Close height="1.4em" /></button>
			</div>
			<div class="avatar-grid" role="group" aria-labelledby="avatar-picker-title">
				{#each avatars as option (option.id)}
					<button type="button" class:selected={avatar === option.id} aria-label={option.label()} aria-pressed={avatar === option.id} onclick={() => chooseAvatar(option.id)}>
						<Avatar id={option.id} />
					</button>
				{/each}
			</div>
		</Modal>
		<Footer />
	</div>
</NiceBackground>

<style>
	.page {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	header {
		margin: 0.5em 0;
	}

	form {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		gap: 0.75em;
		border-radius: 10px;
		width: min(calc(100% - 2em), 22rem);
	}

	.submit {
		display: flex;
		justify-content: center;
	}

	.submit-label {
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--alternative-font);
	}

	.loading {
		height: 0.8em;
		aspect-ratio: 1 / 1;
		margin: 0 5px;
	}
	.avatar-preview { display: flex; justify-content: center; }
	.avatar-trigger { display: inline-flex; border: 0; border-radius: 50%; padding: 0; background: none; color: var(--primary); cursor: pointer; }
	.avatar-trigger:disabled { opacity: 0.6; cursor: default; }
	.avatar-trigger:focus-visible { outline: 3px solid var(--primary); outline-offset: 5px; }
	.avatar-image { position: relative; display: inline-flex; border-radius: 50%; }
	.avatar-trigger:not(:disabled):hover .avatar-image { box-shadow: 0 0 0 3px var(--primary); }
	.edit-badge { position: absolute; inset-inline-end: 0; bottom: 0; display: grid; place-items: center; width: 2rem; height: 2rem; border: 2px solid var(--surface); border-radius: 50%; background: var(--primary); color: var(--on-primary); }
	.picker-heading { display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 1rem; }
	h2 { margin: 0; text-align: center; }
	.picker-close { position: absolute; inset-inline-end: 0; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--on-surface); cursor: pointer; }
	.picker-close:hover { background: var(--surface-variant); }
	.picker-close:focus-visible { outline: 3px solid var(--primary); outline-offset: 2px; }
	.avatar-grid button:focus-visible { outline: 3px solid var(--on-surface); outline-offset: 2px; }
	.avatar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(76px, 1fr)); gap: 0.5em; }
	.avatar-grid button { display: flex; justify-content: center; justify-self: center; width: 76px; height: 76px; box-sizing: border-box; padding: 3px; border: 3px solid transparent; border-radius: 50%; background: transparent; cursor: pointer; }
	.avatar-grid button:hover { background: var(--surface-variant); }
	.avatar-grid button.selected { border-color: var(--primary); }
</style>
