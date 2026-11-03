<script lang="ts">
	import LlmSettings from '$lib/admin/LlmSettings.svelte';
	import TypicalPage from '$lib/layout/TypicalPage.svelte';
	import * as m from '$lib/paraglide/messages.js';

	let { data } = $props();
</script>

<svelte:head><title>{m.llm_title()}</title></svelte:head>
<TypicalPage>
	{#if data.llm}<LlmSettings initial={data.llm} />{:else}<p role="alert">{m.llm_unavailable()}</p>{/if}
</TypicalPage>
