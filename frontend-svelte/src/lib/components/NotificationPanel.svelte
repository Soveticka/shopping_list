<script lang="ts">
	import { onMount } from 'svelte';
	import { notificationsStore, type Notification } from '$lib/stores/notifications';
	import NotificationItem from './NotificationItem.svelte';
	import LoadingSpinner from './LoadingSpinner.svelte';

	export let isOpen = false;
	
	let loading = false;
	let error: string | null = null;
	let notifications: Notification[] = [];
	let unreadCount = 0;
	let showUnreadOnly = false;
	let hasMore = true;
	let currentOffset = 0;
	const pageSize = 20;

	// Subscribe to store changes
	$: ({ 
		notifications, 
		unreadCount, 
		loading, 
		error 
	} = $notificationsStore);

	onMount(() => {
		if (isOpen) {
			loadNotifications();
		}
	});

	// Watch for panel opening
	$: if (isOpen && notifications.length === 0) {
		loadNotifications();
	}

	async function loadNotifications(append = false) {
		try {
			const offset = append ? currentOffset : 0;
			await notificationsStore.loadNotifications(pageSize, offset, showUnreadOnly);
			
			if (!append) {
				currentOffset = pageSize;
			} else {
				currentOffset += pageSize;
			}
			
			// Check if we have more notifications to load
			hasMore = notifications.length >= currentOffset;
		} catch (err) {
			console.error('Failed to load notifications:', err);
		}
	}

	async function loadMore() {
		if (!loading && hasMore) {
			await loadNotifications(true);
		}
	}

	async function handleMarkAsRead(notification: Notification) {
		try {
			await notificationsStore.markAsRead(notification.id, !notification.is_read);
		} catch (err) {
			console.error('Failed to mark notification:', err);
		}
	}

	async function handleDelete(notification: Notification) {
		if (confirm('Opravdu chcete smazat tuto notifikaci?')) {
			try {
				await notificationsStore.deleteNotification(notification.id);
			} catch (err) {
				console.error('Failed to delete notification:', err);
			}
		}
	}

	async function handleMarkAllAsRead() {
		try {
			await notificationsStore.markAllAsRead();
		} catch (err) {
			console.error('Failed to mark all as read:', err);
		}
	}

	async function handleFilterChange() {
		currentOffset = 0;
		hasMore = true;
		await loadNotifications();
	}

	function handleOutsideClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.notification-panel')) {
			isOpen = false;
		}
	}
</script>

<svelte:window on:click={handleOutsideClick} />

{#if isOpen}
	<div class="notification-panel" role="dialog" aria-label="Notifikace">
		<div class="panel-header">
			<h3>Notifikace</h3>
			<button
				class="close-btn"
				type="button"
				aria-label="Zavřít panel notifikací"
				on:click={() => (isOpen = false)}
			>
				×
			</button>
		</div>

		<div class="panel-controls">
			<div class="filter-controls">
				<label class="checkbox-label">
					<input
						type="checkbox"
						bind:checked={showUnreadOnly}
						on:change={handleFilterChange}
					/>
					Pouze nepřečtené
				</label>
			</div>
			
			{#if unreadCount > 0}
				<button
					class="btn btn-sm btn-primary"
					type="button"
					on:click={handleMarkAllAsRead}
					disabled={loading}
				>
					Označit vše jako přečtené
				</button>
			{/if}
		</div>

		<div class="notifications-list">
			{#if loading && notifications.length === 0}
				<div class="loading-container">
					<LoadingSpinner />
					<p>Načítání notifikací...</p>
				</div>
			{:else if error}
				<div class="error-container">
					<p class="error-message">Chyba při načítání: {error}</p>
					<button
						class="btn btn-sm btn-secondary"
						type="button"
						on:click={() => loadNotifications()}
					>
						Zkusit znovu
					</button>
				</div>
			{:else if notifications.length === 0}
				<div class="empty-state">
					<p>
						{showUnreadOnly ? 'Žádné nepřečtené notifikace' : 'Žádné notifikace'}
					</p>
				</div>
			{:else}
				{#each notifications as notification (notification.id)}
					<NotificationItem
						{notification}
						on:markAsRead={() => handleMarkAsRead(notification)}
						on:delete={() => handleDelete(notification)}
					/>
				{/each}

				{#if hasMore && !loading}
					<button
						class="load-more-btn"
						type="button"
						on:click={loadMore}
						disabled={loading}
					>
						Načíst další
					</button>
				{:else if loading}
					<div class="loading-more">
						<LoadingSpinner size="small" />
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.notification-panel {
		position: fixed;
		top: 60px;
		right: 16px;
		width: 360px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 80px);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
		z-index: 1000;
		display: flex;
		flex-direction: column;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		border-radius: 8px 8px 0 0;
	}

	.panel-header h3 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 1.5rem;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 4px;
		transition: all 0.2s ease;
	}

	.close-btn:hover {
		background: var(--background-hover);
		color: var(--text-primary);
	}

	.panel-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--background-light);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.9rem;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.checkbox-label input[type="checkbox"] {
		margin: 0;
	}

	.notifications-list {
		flex: 1;
		overflow-y: auto;
		max-height: 400px;
	}

	.loading-container,
	.error-container,
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px 16px;
		text-align: center;
		color: var(--text-secondary);
	}

	.error-message {
		color: var(--danger);
		margin-bottom: 12px;
	}

	.load-more-btn {
		width: 100%;
		padding: 12px;
		background: var(--background-light);
		border: none;
		border-top: 1px solid var(--border);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.load-more-btn:hover:not(:disabled) {
		background: var(--background-hover);
	}

	.load-more-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.loading-more {
		display: flex;
		justify-content: center;
		padding: 12px;
		border-top: 1px solid var(--border);
	}

	/* Mobile responsiveness */
	@media (max-width: 480px) {
		.notification-panel {
			top: 56px;
			right: 8px;
			left: 8px;
			width: auto;
			max-width: none;
		}

		.panel-controls {
			flex-direction: column;
			gap: 8px;
			align-items: stretch;
		}
	}
</style>