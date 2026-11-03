<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import LlmDropdown from '$lib/admin/LlmDropdown.svelte';
	import {
		defaultLlmSettings,
		type LlmConfiguration,
		type LlmList,
		type LlmSettings,
		llmCapabilities,
		llmProviders,
		resetLlmParameters
	} from '$lib/ai/llmConfiguration';
	import { llmErrorMessage } from '$lib/ai/llmMessages';
	import claudeLogo from '$lib/assets/provider-logos/claude.svg';
	import geminiLogo from '$lib/assets/provider-logos/gemini.svg';
	import ollamaLogo from '$lib/assets/provider-logos/ollama.svg';
	import openaiLogo from '$lib/assets/provider-logos/openai.svg';
	import openaiCompatibleLogo from '$lib/assets/provider-logos/openai-compatible.svg';
	import vllmLogo from '$lib/assets/provider-logos/vllm.svg';
	import ConfirmationDialog from '$lib/feedback/ConfirmationDialog.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { currentIdentity, onAccountStorageCleared } from '$lib/storage/account';
	import FancyAnchorButton from '$lib/ui/FancyAnchorButton.svelte';
	import FancyButton from '$lib/ui/FancyButton.svelte';

	type Initial = LlmList & {
		actorId: string;
		sessionIssuedAt: number;
		legacy: { available: boolean; settings: LlmSettings | null; hasApiKey: boolean } | null;
	};
	let { initial }: { initial: Initial } = $props();
	let list = $state(untrack(() => initial));
	let selected = $state<LlmConfiguration | null>(null);
	let form = $state(defaultLlmSettings());
	let original = $state(JSON.stringify(defaultLlmSettings()));
	let credentialAction = $state<'keep' | 'replace' | 'remove'>('keep');
	let replacementKey = $state('');
	let busy = $state('');
	let error = $state('');
	let saved = $state(false);
	let deleted = $state(false);
	let deleteDialog = $state<ConfirmationDialog>();
	let deleteTarget = $state<{
		configuration: LlmConfiguration;
		selectionVersion: number;
		active: boolean;
	} | null>(null);
	let audit = $state<
		{
			id: string;
			actorId: string;
			createdAt: string;
			action: string;
			changedFields: string[];
			credentialAction: string;
		}[]
	>([]);
	let tested = $state<string | null>(null);
	let sequence = 0;
	const capability = $derived(llmCapabilities(form.provider, form.model));
	const fingerprint = $derived(
		JSON.stringify({ form, credentialAction, replacementKey, version: selected?.version })
	);
	const dirty = $derived(
		JSON.stringify(form) !== original || credentialAction !== 'keep' || !!replacementKey
	);
	const destinationChanged = $derived(
		!!selected?.hasApiKey &&
			(selected.provider !== form.provider || selected.endpoint !== form.endpoint)
	);
	const active = $derived(list.configurations.find((c) => c.id === list.selection.activeId));
	const labels = $derived({
		maxOutputTokens: m.llm_tokens(),
		requestTimeoutSeconds: m.llm_request_timeout(),
		generationTimeoutSeconds: m.llm_overall_timeout(),
		batchSize: m.llm_batch_size(),
		maxConcurrentOperations: m.llm_concurrency()
	});
	const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	});
	const parameterFields = [
		'maxOutputTokens',
		'requestTimeoutSeconds',
		'generationTimeoutSeconds',
		'batchSize',
		'maxConcurrentOperations'
	] as const;
	const providerOptions = llmProviders.map((value) => ({
		value,
		icon: {
			ollama: ollamaLogo,
			vllm: vllmLogo,
			openai: openaiLogo,
			gemini: geminiLogo,
			claude: claudeLogo,
			custom: openaiCompatibleLogo
		}[value],
		label: {
			ollama: 'Ollama',
			vllm: 'vLLM',
			openai: 'OpenAI',
			gemini: 'Gemini',
			claude: 'Claude',
			custom: 'OpenAI-compatible'
		}[value]
	}));
	const credentialOptions = $derived([
		{ value: 'keep', label: m.llm_key_keep() },
		{ value: 'replace', label: m.llm_key_replace() },
		{ value: 'remove', label: m.llm_key_remove() }
	]);
	const auditLabels: Record<string, string> = $derived({
		...labels,
		name: m.llm_name(),
		provider: m.llm_provider(),
		endpoint: m.llm_endpoint(),
		model: m.llm_model(),
		enabled: m.llm_enabled(),
		temperature: m.llm_temperature(),
		topP: m.llm_top_p(),
		activeId: m.llm_active(),
		apiKey: m.llm_api_key(),
		deletedAt: m.llm_delete(),
		delete: m.llm_delete(),
		create: m.llm_new(),
		update: m.save_changes(),
		import: m.llm_import(),
		activate: m.llm_activate(),
		deactivate: m.llm_deactivate(),
		keep: m.llm_key_keep(),
		remove: m.llm_key_remove(),
		replace: m.llm_key_replace()
	});
	function edit(config: LlmConfiguration | null) {
		sequence++;
		deleteDialog?.close();
		deleteTarget = null;
		deleted = false;
		selected = config;
		form = config
			? (Object.fromEntries(
					Object.keys(defaultLlmSettings()).map((key) => [key, config[key as keyof LlmSettings]])
				) as LlmSettings)
			: defaultLlmSettings();
		original = JSON.stringify(form);
		credentialAction = 'keep';
		replacementKey = '';
		tested = null;
		error = '';
		saved = false;
		audit = [];
	}
	const removeListener = onAccountStorageCleared(() => {
		edit(null);
		list = { ...list, configurations: [], legacy: null };
	});
	onDestroy(() => {
		sequence++;
		replacementKey = '';
		removeListener();
	});
	async function api(action: string, body?: unknown) {
		const response = await fetch(resolve(`/api/admin/llm${action ? `/${action}` : ''}`), {
			method: body === undefined ? 'GET' : 'POST',
			cache: 'no-store',
			headers: {
				'content-type': 'application/json',
				'x-seopen-account': initial.actorId,
				'x-seopen-session': String(initial.sessionIssuedAt)
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		const result = await response.json();
		if (!response.ok)
			throw new Error(
				llmErrorMessage(
					typeof result.error === 'string' ? result.error : 'configuration_unavailable'
				)
			);
		const identity = await currentIdentity();
		if (
			identity.user.id !== initial.actorId ||
			identity.sessionIssuedAt !== initial.sessionIssuedAt
		)
			throw new Error(m.llm_authentication_error());
		return result;
	}
	async function run(action: 'save' | 'test') {
		if (busy) return;
		const current = ++sequence,
			signature = fingerprint;
		busy = action;
		error = '';
		saved = false;
		try {
			const result = await api(action, {
				id: selected?.id ?? null,
				expectedVersion: selected?.version ?? null,
				settings: $state.snapshot(form),
				credential:
					credentialAction === 'replace'
						? { action: 'replace', value: replacementKey }
						: { action: credentialAction }
			});
			if (current !== sequence || signature !== fingerprint) return;
			if (action === 'test') tested = signature;
			if (action === 'save') {
				list = await api('');
				edit(result.configuration);
				saved = true;
			}
		} catch (cause) {
			if (current === sequence && signature === fingerprint)
				error = cause instanceof Error ? cause.message : m.llm_unavailable();
		} finally {
			busy = '';
		}
	}
	async function select(id: string | null) {
		busy = 'select';
		error = '';
		try {
			const config = list.configurations.find((c) => c.id === id);
			await api('select', {
				id,
				expectedConfigurationVersion: config?.version ?? null,
				expectedSelectionVersion: list.selection.version
			});
			list = await api('');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.llm_unavailable();
		} finally {
			busy = '';
		}
	}
	function requestDelete() {
		if (!selected || busy || dirty) return;
		deleteTarget = {
			configuration: $state.snapshot(selected),
			selectionVersion: list.selection.version,
			active: selected.id === list.selection.activeId
		};
		deleteDialog?.open();
	}
	async function removeConfiguration() {
		if (!deleteTarget || busy || dirty) return;
		const target = deleteTarget,
			current = ++sequence;
		busy = 'delete';
		error = '';
		try {
			await api('delete', {
				id: target.configuration.id,
				expectedVersion: target.configuration.version,
				expectedSelectionVersion: target.selectionVersion
			});
			if (current !== sequence) return;
			const refreshed = await api('');
			if (current !== sequence) return;
			list = refreshed;
			edit(null);
			deleted = true;
		} catch (cause) {
			if (current === sequence)
				error = cause instanceof Error ? cause.message : m.llm_unavailable();
		} finally {
			busy = '';
		}
	}
	async function importLegacy() {
		busy = 'import';
		error = '';
		try {
			const result = await api('import', {});
			list = await api('');
			edit(result.configuration);
			saved = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.llm_unavailable();
		} finally {
			busy = '';
		}
	}
	async function reload() {
		busy = 'reload';
		try {
			list = await api('');
			edit(list.configurations.find((c) => c.id === selected?.id) ?? null);
		} catch {
			error = m.llm_unavailable();
		} finally {
			busy = '';
		}
	}
	async function history() {
		if (!selected) return;
		const current = sequence,
			id = selected.id;
		try {
			const result = await api('audit', { id });
			if (current === sequence && selected?.id === id) audit = result.audit;
		} catch {
			if (current === sequence && selected?.id === id) error = m.llm_unavailable();
		}
	}
	function applyCapability() {
		const next = llmCapabilities(form.provider, form.model);
		if (!next.sampling) {
			form.temperature = null;
			form.topP = null;
		} else if (next.exclusiveSampling && form.temperature !== null && form.topP !== null)
			form.topP = null;
	}
</script>

<main>
	<header><div><h1>{m.llm_title()}</h1><p>{m.llm_sampling_help()}</p></div><FancyAnchorButton variant="secondary" href={resolve(localizeHref('/'))}>{m.back_home()}</FancyAnchorButton></header>
	<p class="status" role="status">{active?.enabled ? `${m.llm_active()}: ${active.name}` : m.llm_no_active()}</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if deleted}<p role="status">{m.llm_deleted()}</p>{/if}
	{#if list.legacy?.available}
		<section class="legacy"><h2>{m.llm_import()}</h2><p>{m.llm_import_help()}</p><p>{list.legacy.settings?.endpoint} · {list.legacy.settings?.model} · {list.legacy.hasApiKey ? m.llm_key_present() : m.llm_key_absent()}</p>
		{#if list.legacy.settings}
			<dl class="legacy-values">
				<dt>{m.llm_provider()}</dt><dd>{list.legacy.settings.provider}</dd>
				<dt>{m.llm_enabled()}</dt><dd>{list.legacy.settings.enabled ? m.llm_enabled() : m.llm_disabled()}</dd>
				<dt>{m.llm_temperature()}</dt><dd>{list.legacy.settings.temperature ?? m.llm_provider_controlled()}</dd>
				<dt>{m.llm_top_p()}</dt><dd>{list.legacy.settings.topP ?? m.llm_provider_controlled()}</dd>
				{#each parameterFields as key (key)}<dt>{labels[key]}</dt><dd>{list.legacy.settings[key]}</dd>{/each}
			</dl>
		{/if}<FancyButton disabled={!!busy || dirty} onclick={importLegacy}>{m.llm_import()}</FancyButton></section>
	{/if}
	<div class="workspace">
		<aside aria-label={m.llm_title()}>
			<FancyButton disabled={!!busy || dirty} onclick={() => edit(null)}>{m.llm_new()}</FancyButton>
			{#if !list.configurations.length}<p>{m.llm_empty()}</p>{/if}
			{#each list.configurations as config (config.id)}
				<button class="configuration" class:selected={selected?.id === config.id} disabled={!!busy || dirty} onclick={() => edit(config)}><strong>{config.name}</strong><span>{config.provider} · {config.enabled ? m.llm_enabled() : m.llm_disabled()}{config.id === list.selection.activeId ? ` · ${m.llm_active()}` : ''}</span></button>
			{/each}
		</aside>
		<section class="editor">
			<div class="editor-heading"><h2>{selected ? selected.name : m.llm_new()}</h2><span role="status">{dirty ? m.llm_unsaved() : saved || selected ? m.llm_saved() : m.llm_new()}</span></div>
			<form onsubmit={event => { event.preventDefault(); void run('save'); }}>
				<fieldset disabled={busy === 'save' || busy === 'delete'}>
					<div class="fields">
						<label>{m.llm_name()}<input required maxlength="100" bind:value={form.name} /></label>
						<LlmDropdown id="llm-provider-options" label={m.llm_provider()} value={form.provider} options={providerOptions} onselect={value => { form.provider = value as LlmSettings['provider']; applyCapability(); }} />
						<label class="wide">{m.llm_endpoint()}<input type="url" required maxlength="2048" bind:value={form.endpoint} /></label>
					</div>
					<p class="help">{m.llm_destination_help()}</p>
					<label>{m.llm_model()}<input required maxlength="256" bind:value={form.model} onchange={applyCapability} /></label>
					<label class="check"><input type="checkbox" bind:checked={form.enabled} />{m.llm_enabled()}</label>
					<h3>{m.llm_api_key()}</h3><p>{selected?.hasApiKey ? m.llm_key_present() : m.llm_key_absent()}</p>
					<LlmDropdown id="llm-credential-options" label={m.llm_api_key()} value={credentialAction} options={credentialOptions} onselect={value => credentialAction = value as typeof credentialAction} />
					{#if credentialAction === 'replace'}<label>{m.llm_key_replace()}<input type="password" required autocomplete="new-password" bind:value={replacementKey} /></label>{/if}
					{#if destinationChanged && credentialAction === 'keep'}<p role="alert" class="error">{m.llm_credentials_error()}</p>{/if}
					<div class="fields">
						{#each ['temperature', 'topP'] as parameter (parameter)}
							{@const key = parameter as 'temperature' | 'topP'}
							<div><label>{key === 'temperature' ? m.llm_temperature() : m.llm_top_p()}<input type="number" step="0.01" min={key === 'temperature' ? 0 : 0.01} max={key === 'temperature' ? capability.maxTemperature : 1} disabled={!capability.sampling || form[key] === null} value={form[key] ?? ''} oninput={event => form[key] = event.currentTarget.valueAsNumber} /></label><label class="check"><input type="checkbox" checked={form[key] === null} disabled={!capability.sampling} onchange={event => form[key] = event.currentTarget.checked ? null : key === 'temperature' ? 0.5 : 0.95} />{m.llm_provider_controlled()}</label></div>
						{/each}
						{#each parameterFields as key (key)}<label>{labels[key]}<input type="number" required step="1" min={key === 'maxOutputTokens' ? 128 : 1} max={key === 'maxConcurrentOperations' ? undefined : key === 'maxOutputTokens' ? 16384 : key === 'batchSize' ? 20 : key === 'requestTimeoutSeconds' ? 900 : 1800} bind:value={form[key]} /></label>{/each}
					</div>
					<p class="help">{m.llm_batch_help()}</p>
					<p class="help">{m.llm_concurrency_help()}</p>
					<div class="actions"><FancyButton type="button" variant="secondary" onclick={() => form = resetLlmParameters(form)}>{m.llm_reset()}</FancyButton><FancyButton type="button" variant="ghost" disabled={!!busy} onclick={() => edit(selected)}>{m.llm_discard()}</FancyButton></div>
					<p class="help">{m.llm_reset_help()}</p>
				</fieldset>
				<div class="actions"><FancyButton type="submit" disabled={!!busy || (destinationChanged && credentialAction === 'keep')}>{m.save_changes()}</FancyButton><FancyButton type="button" variant="secondary" disabled={!!busy} onclick={() => run('test')}>{m.llm_test()}</FancyButton><FancyButton type="button" variant="ghost" disabled={!!busy} onclick={reload}>{m.llm_reload()}</FancyButton></div>
				<p class="help">{m.llm_test_notice()}</p><p role="status">{busy ? m.llm_working() : tested === fingerprint ? m.llm_test_success() : m.llm_untested()}</p>
			</form>
			{#if selected}<div class="actions"><FancyButton disabled={!!busy || dirty || !selected.enabled || selected.id === list.selection.activeId} onclick={() => select(selected!.id)}>{m.llm_activate()}</FancyButton>{#if list.selection.activeId === selected.id}<FancyButton variant="secondary" disabled={!!busy || dirty} onclick={() => select(null)}>{m.llm_deactivate()}</FancyButton>{/if}<FancyButton variant="ghost" disabled={!!busy} onclick={history}>{m.llm_audit()}</FancyButton><FancyButton variant="danger" disabled={!!busy || dirty} onclick={requestDelete}>{m.llm_delete()}</FancyButton></div><p class="help">{selected.version} · {dateTimeFormat.format(new Date(selected.updatedAt))}</p>{/if}
			{#if audit.length}<ul class="audit">{#each audit as entry (entry.id)}<li>{dateTimeFormat.format(new Date(entry.createdAt))} · {entry.actorId}<br />{auditLabels[entry.action]} · {entry.changedFields.map(field => auditLabels[field]).join(', ')} · {auditLabels[entry.credentialAction]}</li>{/each}</ul>{/if}
		</section>
	</div>
</main>

<ConfirmationDialog
	bind:this={deleteDialog}
	title={m.llm_delete()}
	message={deleteTarget ? `${m.llm_delete_message({ name: deleteTarget.configuration.name })}${deleteTarget.active ? ` ${m.llm_delete_active_warning()}` : ''}` : ''}
	confirmText={m.llm_delete()}
	onConfirm={removeConfiguration}
/>

<style>
	main { max-width: 1200px; margin: auto; padding: 2rem 1.25rem; }
	header, .editor-heading, .actions { display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
	header > div { flex: 1; min-width: 16rem; }
	h1, h2, h3, p { margin: 0; } h1 { font-size: clamp(1.6rem, 4vw, 2.25rem); } h2 { font-size: 1.3rem; } h3 { font-size: 1.05rem; margin-top: .5rem; }
	header p, .help, .configuration span { color: var(--on-surface-variant); font-size: .9rem; line-height: 1.6; }
	.status, .legacy { margin: 1.25rem 0; padding: 1rem; background: var(--surface-variant); border-radius: .6rem; }
	.legacy-values { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem 1rem; margin: 0; } .legacy-values dd { margin: 0; }
	.legacy { display: grid; gap: .75rem; overflow-wrap: anywhere; }
	.workspace { display: grid; grid-template-columns: 16rem minmax(0, 1fr); gap: 1.5rem; }
	aside, form, fieldset, .editor { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
	.editor { border: 1px solid var(--outline); border-radius: .75rem; padding: 1.25rem; }
	fieldset { border: 0; margin: 0; padding: 0; }
	.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
	.wide { grid-column: 1 / -1; } label { display: grid; gap: .4rem; min-width: 0; }
	input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 2.75rem; border: 1px solid var(--outline); border-radius: .4rem; padding: .5rem .7rem; font: inherit; color: inherit; background: var(--surface); }
	.check { display: flex; align-items: center; gap: .5rem; margin-top: .5rem; } .check input { width: 1.1rem; min-height: 1.1rem; }
	.configuration { text-align: start; display: grid; gap: .4rem; border: 1px solid var(--outline); border-radius: .5rem; padding: 1rem; color: inherit; background: var(--surface); overflow-wrap: anywhere; cursor: pointer; }
	.configuration.selected { border-color: var(--primary); box-shadow: inset 3px 0 var(--primary); }
	button:disabled { cursor: default; opacity: .6; } input:focus-visible, button:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; }
	.actions { justify-content: flex-start; } .error { color: var(--error, #b42318); padding: .75rem 0; overflow-wrap: anywhere; }
	.audit { padding-inline-start: 1.2rem; overflow-wrap: anywhere; font-size: .85rem; } .audit li { margin-bottom: .75rem; }
	@media(max-width: 850px) { .workspace { grid-template-columns: 1fr; } aside { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media(max-width: 500px) { main { padding: 1rem .75rem; } .fields, aside { grid-template-columns: 1fr; } .editor { padding: 1rem; } }
</style>
