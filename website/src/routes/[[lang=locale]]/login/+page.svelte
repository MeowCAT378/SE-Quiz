<script lang="ts">
	import Login from '../admin/login/+page.svelte';

	let { data, form } = $props();
</script>

<Login {data} {form} />
