<script lang="ts">
	import { untrack } from 'svelte';
	import Library from '../src/routes/[[lang=locale]]/library/public/[id]/+page.svelte';
	import Share from '../src/routes/[[lang=locale]]/share/[id]/+page.svelte';

	let { library = false }: { library?: boolean } = $props();
	const source = (title: string) => ({
		user: { id: 'test' },
		fuiz: library ? { id: title, title, author: '', language: 'en' } : { title, slides: [] },
		config: { title, slides: [] }
	});
	let data = $state<any>(untrack(() => source('Source A')));
	export function changeSource() {
		data = source('Source B');
	}
</script>
{#if library}<Library {data} />{:else}<Share {data} />{/if}
