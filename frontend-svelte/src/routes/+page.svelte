<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import ShoppingApp from '$lib/components/ShoppingApp.svelte';

	$: isAuthenticated = $authStore.isAuthenticated;
	$: isLoading = $authStore.isLoading;
</script>

<svelte:head>
	<title>Shopping List</title>
	<meta name="description" content="Modern shopping list app with sharing capabilities" />
</svelte:head>

{#if isLoading}
	<div class="loading-container">
		<div class="loading-spinner"></div>
		<p>Loading...</p>
	</div>
{:else if isAuthenticated}
	<ShoppingApp />
{:else}
	<AuthModal />
{/if}

<style>
	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		gap: 1rem;
	}

	.loading-spinner {
		width: 40px;
		height: 40px;
		border: 4px solid var(--border);
		border-top: 4px solid var(--primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
</style>