<script lang="ts">
	import { untrack } from 'svelte';
	import { addIds } from '../src/lib/clientOnly';
	import type { Database, ExportedFuiz } from '../src/lib/storage';
	import Editor from '../src/routes/[[lang=locale]]/create/Editor.svelte';

	let { database, record, alias }: { database: Database; record: ExportedFuiz; alias: number } =
		$props();
	let config = $state(untrack(() => addIds(record.config)));
	let exported = $state(untrack(() => structuredClone(record)));
	let id = $state(untrack(() => alias));
</script>
<Editor bind:config bind:exportedFuiz={exported} bind:id db={database} showShare={true} />
