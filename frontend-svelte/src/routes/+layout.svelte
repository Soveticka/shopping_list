<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import '../app.css';

	onMount(() => {
		// Initialize auth state when app loads
		authStore.loadCurrentUser();
	});
</script>

<main class="app-container">
	<slot />
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background-color: var(--background);
		color: var(--text-primary);
	}
	
	.app-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}
</style>