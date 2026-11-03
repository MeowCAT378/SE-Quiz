<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ErrorMessage from '$lib/feedback/ErrorMessage.svelte';
	import LoadingCircle from '$lib/feedback/LoadingCircle.svelte';
	import Footer from '$lib/layout/Footer.svelte';
	import Header from '$lib/layout/Header.svelte';
	import NiceBackground from '$lib/layout/NiceBackground.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime.js';
	import FancyAnchorButton from '$lib/ui/FancyAnchorButton.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import AdminPanelSettings from '~icons/material-symbols/admin-panel-settings';
	import ArrowBack from '~icons/material-symbols/arrow-back';
	import Key from '~icons/material-symbols/key';
	import Person from '~icons/material-symbols/person';

	let {
		data,
		form
	}: {
		data: { returnTo?: string };
		form?: {
			message?: string;
			missing?: boolean;
			unavailable?: boolean;
			throttled?: boolean;
		} | null;
	} = $props();

	let loading = $state(false);
	let email = $state('');
	let password = $state('');
</script>

<svelte:head>
	<title>{m.admin_login_title()}</title>
</svelte:head>

<NiceBackground>
	<div class="page">
		<header class="header">
			<Header />
		</header>

		<div class="login-container">
			<div class="card">
				<div class="icon-wrap">
					<AdminPanelSettings height="2.5em" width="2.5em" />
				</div>
				<h1 class="title">{m.admin_login()}</h1>
				<p class="subtitle">{m.admin_login_description()}</p>

				{#if form?.message}
					<div class="error-wrap">
						<ErrorMessage errorMessage={form.unavailable ? m.authentication_unavailable() : form.throttled ? m.login_throttled() : form.missing ? m.login_missing() : m.login_invalid()} />
					</div>
				{/if}

				<form
					method="POST"
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							loading = false;
							await update();
						};
					}}
				>
					<input type="hidden" name="returnTo" value={data?.returnTo || '/'} />

					<div class="field-group">
						<label for="email" class="field-label">
							<Person height="1.1em" />
							<span>{m.email()}</span>
						</label>
						<input
							id="email"
							name="email"
							type="email"
							autocomplete="username"
							class="password-input"
							placeholder=""
							required={true}
							disabled={loading}
							bind:value={email}
							oninvalid={(event) => event.currentTarget.setCustomValidity(m.email_required())}
							oninput={(event) => event.currentTarget.setCustomValidity('')}
						/>
					</div>

					<div class="field-group">
						<label for="password" class="field-label">
							<Key height="1.1em" />
							<span>{m.password()}</span>
						</label>
						<input
							type="password"
							id="password"
							name="password"
							autocomplete="current-password"
							class="password-input"
							placeholder="••••••••"
							required
							disabled={loading}
							bind:value={password}
							oninvalid={(event) => event.currentTarget.setCustomValidity(m.password_required())}
							oninput={(event) => event.currentTarget.setCustomValidity('')}
						/>
					</div>

					<div class="actions">
						<div class="btn-group">
							<FancyButton fill disabled={loading}>
							<div class="cta">
								{#if loading}
									<div class="spinner">
										<LoadingCircle />
									</div>
								{/if}
								{m.login()}
							</div>
							</FancyButton>
						</div>
						<FancyAnchorButton variant="secondary" href={resolve(localizeHref('/'))}>
							<div class="back-btn-inner">
								<ArrowBack height="1em" />
								<span>{m.back_home()}</span>
							</div>
						</FancyAnchorButton>
					</div>
				</form>
			</div>
		</div>

		<Footer />
	</div>
</NiceBackground>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
	}

	.header {
		margin: 1em 0;
	}

	.login-container {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 1.5em;
		box-sizing: border-box;
	}

	.card {
		background: var(--surface, rgba(255, 255, 255, 0.08));
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
		border-radius: 1.2em;
		padding: 2.2em 2em;
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		align-items: center;
		box-shadow: 0 16px 36px rgba(0, 0, 0, 0.25);
	}

	.icon-wrap {
		color: var(--primary, #3b82f6);
		margin-bottom: 0.5em;
	}

	.title {
		font-size: 1.6em;
		font-weight: 700;
		margin: 0 0 0.2em;
		font-family: var(--alternative-font);
		text-align: center;
	}

	.subtitle {
		font-size: 0.9em;
		opacity: 0.75;
		margin: 0 0 1.5em;
		text-align: center;
	}

	.error-wrap {
		width: 100%;
		margin-bottom: 1em;
	}

	form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1em;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.35em;
		width: 100%;
	}

	.field-label {
		display: flex;
		align-items: center;
		gap: 0.35em;
		font-size: 0.85em;
		font-weight: 600;
		opacity: 0.85;
	}

	.password-input {
		width: 100%;
		padding: 0.6em 0.8em;
		border-radius: 0.5em;
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		background: color-mix(in srgb, currentColor 5%, transparent);
		color: inherit;
		font-size: 1em;
		box-sizing: border-box;
		transition: border-color 150ms ease;
	}

	.password-input:focus {
		outline: none;
		border-color: var(--primary, #3b82f6);
	}

	.actions {
		width: 100%;
		margin-top: 0.5em;
		display: grid;
		gap: 0.75em;
		justify-items: center;
	}

	.btn-group {
		width: 100%;
	}

	.cta {
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--alternative-font);
		padding: 0.3em 0.5em;
		font-size: 1.05em;
	}

	.spinner {
		height: 1.2em;
		aspect-ratio: 1 / 1;
		margin-right: 8px;
	}

	.back-btn-inner {
		display: flex;
		align-items: center;
		gap: 0.4em;
		font-size: 0.85em;
		padding: 0.2em 0.5em;
	}
</style>
