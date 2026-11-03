<script lang="ts">
	import { resolve } from '$app/paths';
	import Header from '$lib/layout/Header.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import type { PublicAccount } from '$lib/server/accounts';
	import { clearAccountStorage } from '$lib/storage/account';
	import DarkModeSwitcher from '$lib/ui/DarkModeSwitcher.svelte';
	import FancyAnchorButton from '$lib/ui/FancyAnchorButton.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import LanguageSwitcher from '$lib/ui/LanguageSwitcher.svelte';
	import AdminPanelSettings from '~icons/material-symbols/admin-panel-settings';
	import LibraryBooks from '~icons/material-symbols/library-books';
	import Palette from '~icons/material-symbols/palette';
	import Settings from '~icons/material-symbols/settings';
	import StadiaController from '~icons/material-symbols/stadia-controller';
	import VolunteerActivism from '~icons/material-symbols/volunteer-activism';

	let {
		showLibrary = false,
		selfHosted = false,
		isAdmin = false,
		user = null
	}: {
		showLibrary?: boolean;
		selfHosted?: boolean;
		isAdmin?: boolean;
		user?: PublicAccount | null;
	} = $props();

	let accountName = $derived(user?.email.split('@', 1)[0] ?? '');
</script>

<header>
	<Header />
	<nav>
		<div class="primary-actions">
		{#if user}
			<FancyAnchorButton variant="ghost" href={resolve(localizeHref('/create'))}>
				<div class="a">
					<Palette height="1.2em" title={m.create()} />
					<div>{m.create()}</div>
				</div>
			</FancyAnchorButton>
		{/if}
		{#if isAdmin}
			<FancyAnchorButton variant="secondary" href={resolve(localizeHref('/admin/users'))}>
				<div class="a">
					<AdminPanelSettings height="1.2em" title={m.user_management()} />
					<div>{m.user_management()}</div>
				</div>
			</FancyAnchorButton>
		{/if}
		<FancyAnchorButton variant="ghost" href={resolve(localizeHref('/play'))}>
			<div class="a">
				<StadiaController height="1.2em" title={m.play()} />
				<div>{m.play()}</div>
			</div>
		</FancyAnchorButton>
		{#if showLibrary}
			<FancyAnchorButton variant="ghost" href={resolve(localizeHref('/library'))}>
				<div class="a">
					<LibraryBooks height="1.2em" title={m.library()} />
					<div>{m.library()}</div>
				</div>
			</FancyAnchorButton>
		{/if}
		{#if !selfHosted}
			<FancyAnchorButton variant="ghost" href="https://opencollective.com/beyond-expiry/projects/fuiz">
				<div class="a">
					<VolunteerActivism height="1.2em" title={m.donate()} />
					<div>{m.donate()}</div>
				</div>
			</FancyAnchorButton>
		{/if}
		</div>

		<div class="account-actions">
		{#if user}
			<span class="identity">
				<span class="account-name" title={accountName}>{accountName}</span>
				<span aria-hidden="true">·</span>
				<span class="account-role">{user.role === 'ADMIN' ? m.admin() : m.teacher_role()}</span>
			</span>
			<form
				class="logout-form"
				method="POST"
				action={resolve(localizeHref('/logout'))}
				onsubmit={() => {
					clearAccountStorage();
					localStorage.setItem('seopen-session-change', String(Date.now()));
				}}
			>
			<FancyButton variant="ghost" type="submit">
				<div class="a admin-btn logout">
					<svg height="1.2em" width="1.2em" viewBox="0 0 24 24" fill="currentColor">
						<path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
					</svg>
					<div>{m.log_out()}</div>
				</div>
			</FancyButton>
			</form>
		{:else}
			<FancyAnchorButton href={resolve(localizeHref('/login'))}>
				<div class="a admin-btn">
					<svg height="1.2em" width="1.2em" viewBox="0 0 24 24" fill="currentColor">
						<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
					</svg>
					<div>{m.login()}</div>
				</div>
			</FancyAnchorButton>
		{/if}
		{#if isAdmin}
			<FancyAnchorButton variant="ghost" href={resolve(localizeHref('/admin/llm'))}>
				<div class="a" title={m.llm_title()}>
					<Settings height="1.2em" title={m.llm_title()} />
				</div>
			</FancyAnchorButton>
		{/if}
		<LanguageSwitcher id="mainheader" />
		<DarkModeSwitcher />
		</div>
	</nav>
</header>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: clamp(1.25em, 3vw, 3em);
		min-height: 80px;
		width: 100%;
		max-width: 1500px;
		margin: 0 auto;
		padding: 0 2em;
		box-sizing: border-box;
	}

	nav {
		display: flex;
		flex: 1;
		min-width: 0;
		justify-content: flex-end;
		align-items: center;
		gap: clamp(0.6em, 1.5vw, 1.5em);
	}

	.primary-actions,
	.account-actions {
		display: flex;
		align-items: center;
		gap: 0.2em;
		min-width: 0;
	}

	.logout-form {
		display: flex;
		margin: 0;
	}

	.account-actions {
		padding-inline-start: clamp(0.6em, 1.5vw, 1.25em);
		border-inline-start: 1px solid var(--outline);
		gap: 0.3em;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 0.3em;
		font-size: 0.78em;
		max-width: 15em;
		min-width: 0;
		white-space: nowrap;
	}

	.account-name {
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.account-role { flex: none; }

	.a {
		display: flex;
		font-family: var(--alternative-font);
		white-space: nowrap;
		align-items: center;
		justify-content: center;
		gap: 0.2em;
		padding: 0.2em;
	}

	@media (max-width: 1200px) {
		header { padding-inline: 1em; }
		.identity { display: none; }
	}

	@media (max-width: 950px) {
		.primary-actions .a div,
		.account-actions .a div { display: none; }
		nav { gap: 0.5em; }
		.account-actions { padding-inline-start: 0.6em; }
	}

	@media (max-width: 600px) {
		header {
			min-height: 0;
			padding-block: 0.55em;
			flex-direction: column;
			gap: 0.4em;
		}
		nav {
			width: 100%;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0.5em 0.2em;
		}
		.account-actions { padding-inline-start: 0.4em; }
	}
</style>
