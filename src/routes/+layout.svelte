<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import 'leaflet/dist/leaflet.css';
	import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
