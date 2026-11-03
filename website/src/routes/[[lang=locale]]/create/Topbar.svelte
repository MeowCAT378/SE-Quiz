<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { downloadFuiz, limits } from '$lib/clientOnly';
	import Logo from '$lib/media/Logo.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import type { CreationId, Database } from '$lib/storage';
	import { getCreation, verifyAccount } from '$lib/storage';
	import FancyButton from '$lib/ui/FancyButton.svelte';
	import Textfield from '$lib/ui/Textfield.svelte';
	import AutoAwesome from '~icons/material-symbols/auto-awesome';
	import Download from '~icons/material-symbols/download';
	import LiveTv from '~icons/material-symbols/live-tv-outline';
	import Publish from '~icons/material-symbols/publish';
	import Share from '~icons/material-symbols/share';

	let {
		title = $bindable(),
		id,
		db,
		errorMessage,
		onshare,
		onsave,
		onerror,
		ongenerate,
		aiAvailable,
		showPublish,
		showShare
	}: {
		title: string;
		id: number;
		db: Database;
		errorMessage: string | undefined;
		onshare: (showCopied: () => void) => void;
		onsave: () => Promise<boolean>;
		onerror: (cause: unknown) => void;
		ongenerate: () => void;
		aiAvailable: boolean;
		showPublish?: boolean;
		showShare?: boolean;
	} = $props();

	let copiedPopover = $state<HTMLDivElement>();
	let shareWrapper = $state<HTMLDivElement>();
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	function showCopied() {
		try {
			copiedPopover?.showPopover({ source: shareWrapper });
		} catch {
			/* already shown */
		}
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => {
			try {
				copiedPopover?.hidePopover();
			} catch {
				/* already hidden */
			}
		}, 1500);
	}

	async function onDownload(id: CreationId) {
		try {
			if (!(await onsave())) return;
			const creation = await getCreation(id, db);
			if (!creation) return;
			const configJson = creation.config;
			await downloadFuiz(configJson, () => verifyAccount(db));
		} catch (cause) {
			onerror(cause);
		}
	}
</script>

<header class="topbar">
	<a class="brand" href={resolve(localizeHref('/create'))} title={m.brand_name()}>
		<Logo height={46} />
	</a>

	<div class="title-wrap">
		<Textfield
			bind:value={title}
			placeholder={m.fuiz_title()}
			required={false}
			id="title"
			disabled={false}
			maxLength={limits.fuiz.maxTitleLength}
		/>
	</div>

	<div class="actions">
		<FancyButton variant="ghost" onclick={ongenerate} disabled={!aiAvailable}>
			<span class="tool-label"><AutoAwesome height="1.1em" />{m.ai_generate()}</span>
		</FancyButton>
		{#if showPublish}
			<FancyButton variant="ghost"
				onclick={async () => {
					if (!(await onsave())) return;
					await goto(resolve(localizeHref('/publish?id=' + id)));
				}}
			>
				<span class="tool-label"><Publish height="1.1em" />{m.publish_title()}</span>
			</FancyButton>
		{/if}
		{#if showShare}
			<div bind:this={shareWrapper}>
				<FancyButton variant="ghost"
					onclick={() => {
						onshare(showCopied);
					}}
				>
					<span class="tool-label"><Share height="1.1em" />{m.share()}</span>
				</FancyButton>
				<div bind:this={copiedPopover} popover="manual" class="fuiz-popover">
					{m.copied()}
				</div>
			</div>
		{/if}
		<FancyButton variant="ghost" onclick={() => onDownload(id)}>
			<span class="tool-label"><Download height="1.1em" />{m.editor_download_file()}</span>
		</FancyButton>
		<div class="host-wrap">
			<FancyButton
				disabled={errorMessage != undefined}
				onclick={async () => {
					if (!(await onsave())) return;
					await goto(resolve(localizeHref(`/quiz/${id}/host`)));
				}}
			>
				<div class="host-label">
					<LiveTv height="1.1em" />
					<span>{m.host()}</span>
				</div>
			</FancyButton>
		</div>
	</div>
</header>
{#if !aiAvailable}<p class="ai-status" role="status">{m.editor_ai_unavailable()}</p>{/if}

<style>
	.topbar {
		display: grid;
		grid-template-columns: calc(12em - 1rem - 0.75rem) minmax(16rem, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 1rem;
		background: var(--surface);
		border-bottom: 1px solid var(--outline);
		z-index: 1;
	}

	.brand {
		display: inline-flex;
		color: inherit;
		text-decoration: none;
		justify-self: center;
	}

	.title-wrap {
		width: 100%;
		min-width: 0;
	}

	.title-wrap :global(.field) {
		gap: 0;
	}

	.title-wrap :global(label) {
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

	.title-wrap :global(input) {
		min-height: 46px;
		padding: 0.55rem 0.75rem;
		background: color-mix(in srgb, var(--surface-variant) 68%, var(--surface));
		border-color: transparent;
		border-radius: 0.6rem;
		font-family: var(--alternative-font);
		font-size: clamp(1rem, 1.4vw, 1.15rem);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title-wrap :global(input:hover) {
		border-color: var(--outline);
	}

	.actions {
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 0.15em;
		justify-self: end;
	}
	.tool-label { display: inline-flex; align-items: center; gap: 0.35em; padding: 0.2em; font-size: 1rem; }
	.ai-status { margin: 0; padding: 0.5rem 1rem; font-size: 1rem; }

	.host-wrap {
		display: inline-block;
		margin-inline-start: 0.3em;
	}

	.host-label {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		padding: 0 0.6em;
		font-family: var(--alternative-font);
		white-space: nowrap;
	}

	@media (max-width: 70em) {
		.topbar {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.5em;
		}

		.brand {
			grid-column: 1;
			grid-row: 1;
			justify-self: start;
		}

		.title-wrap {
			grid-column: 2;
			grid-row: 1;
		}

		.actions {
			grid-column: 1 / -1;
			grid-row: 2;
			justify-self: end;
		}
	}

	@media (max-width: 48em) {
		.topbar {
			grid-template-columns: auto minmax(0, 1fr);
			gap: 0.55rem 0.75rem;
			padding: 0.55rem 0.75rem;
		}

		.brand {
			grid-column: 1;
			grid-row: 1;
		}

		.title-wrap {
			grid-column: 2;
			grid-row: 1;
		}

		.actions {
			grid-column: 1 / -1;
			grid-row: 2;
			flex-wrap: wrap;
			justify-content: flex-start;
			justify-self: stretch;
		}
	}
</style>
