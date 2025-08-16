<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Notification } from '$lib/stores/notifications';

	export let notification: Notification;

	const dispatch = createEventDispatcher<{
		markAsRead: void;
		delete: void;
	}>();

	function formatTimeAgo(dateString: string): string {
		const date = new Date(dateString);
		const now = new Date();
		const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

		if (diffInSeconds < 60) {
			return 'Před chvílí';
		} else if (diffInSeconds < 3600) {
			const minutes = Math.floor(diffInSeconds / 60);
			return `Před ${minutes} min`;
		} else if (diffInSeconds < 86400) {
			const hours = Math.floor(diffInSeconds / 3600);
			return `Před ${hours} h`;
		} else {
			const days = Math.floor(diffInSeconds / 86400);
			return `Před ${days} dny`;
		}
	}

	function getNotificationIcon(type: string): string {
		switch (type) {
			case 'share':
			case 'list_shared':
				return '👥';
			case 'invite':
			case 'invitation':
				return '📧';
			case 'system':
				return '⚙️';
			case 'update':
				return '🔄';
			case 'warning':
				return '⚠️';
			case 'success':
				return '✅';
			case 'info':
			default:
				return 'ℹ️';
		}
	}

	function getNotificationClass(type: string): string {
		switch (type) {
			case 'warning':
				return 'warning';
			case 'success':
				return 'success';
			case 'share':
			case 'invite':
				return 'primary';
			default:
				return 'info';
		}
	}

	function handleMarkAsRead(event: Event) {
		event.stopPropagation();
		dispatch('markAsRead');
	}

	function handleDelete(event: Event) {
		event.stopPropagation();
		dispatch('delete');
	}

	function handleClick() {
		// Mark as read when clicked (if unread)
		if (!notification.is_read) {
			dispatch('markAsRead');
		}
		
		// Handle notification action based on type and data
		if (notification.data) {
			try {
				const data = typeof notification.data === 'string' 
					? JSON.parse(notification.data) 
					: notification.data;
					
				if (data.url) {
					window.location.href = data.url;
				} else if (data.listId) {
					window.location.href = `/lists/${data.listId}`;
				}
			} catch (err) {
				console.warn('Failed to parse notification data:', err);
			}
		}
	}
</script>

<div
	class="notification-item {getNotificationClass(notification.type)}"
	class:unread={!notification.is_read}
	role="button"
	tabindex="0"
	on:click={handleClick}
	on:keypress={(e) => e.key === 'Enter' && handleClick()}
>
	<div class="notification-icon">
		{getNotificationIcon(notification.type)}
	</div>
	
	<div class="notification-content">
		<div class="notification-header">
			<h4 class="notification-title">{notification.title}</h4>
			<div class="notification-actions">
				<button
					class="action-btn mark-read-btn"
					type="button"
					title={notification.is_read ? 'Označit jako nepřečtené' : 'Označit jako přečtené'}
					on:click={handleMarkAsRead}
				>
					{#if notification.is_read}
						<span class="icon">📖</span>
					{:else}
						<span class="icon">✓</span>
					{/if}
				</button>
				<button
					class="action-btn delete-btn"
					type="button"
					title="Smazat notifikaci"
					on:click={handleDelete}
				>
					<span class="icon">🗑️</span>
				</button>
			</div>
		</div>
		
		<p class="notification-message">{notification.message}</p>
		
		<div class="notification-footer">
			<span class="notification-time">{formatTimeAgo(notification.created_at)}</span>
			{#if !notification.is_read}
				<span class="unread-indicator" title="Nepřečtené">●</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.notification-item {
		display: flex;
		gap: 12px;
		padding: 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		cursor: pointer;
		transition: all 0.2s ease;
		position: relative;
	}

	.notification-item:hover {
		background: var(--background-hover);
	}

	.notification-item:last-child {
		border-bottom: none;
	}

	.notification-item.unread {
		background: var(--primary-light);
		border-left: 3px solid var(--primary);
	}

	.notification-item.unread:hover {
		background: rgba(44, 90, 160, 0.08);
	}

	.notification-item.warning {
		border-left-color: var(--warning);
	}

	.notification-item.warning.unread {
		background: var(--warning-light);
	}

	.notification-item.success {
		border-left-color: var(--success);
	}

	.notification-item.success.unread {
		background: var(--success-light);
	}

	.notification-icon {
		font-size: 1.2rem;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.notification-content {
		flex: 1;
		min-width: 0;
	}

	.notification-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}

	.notification-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.3;
		flex: 1;
	}

	.notification-actions {
		display: flex;
		gap: 4px;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.notification-item:hover .notification-actions {
		opacity: 1;
	}

	.action-btn {
		background: none;
		border: none;
		padding: 4px;
		border-radius: 4px;
		cursor: pointer;
		transition: background-color 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.action-btn:hover {
		background: var(--background-hover);
	}

	.action-btn .icon {
		font-size: 0.8rem;
		filter: grayscale(1);
		opacity: 0.7;
	}

	.action-btn:hover .icon {
		filter: none;
		opacity: 1;
	}

	.delete-btn:hover {
		background: var(--danger-light);
	}

	.mark-read-btn:hover {
		background: var(--primary-light);
	}

	.notification-message {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0 0 8px 0;
		line-height: 1.4;
		word-wrap: break-word;
	}

	.notification-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.notification-time {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.unread-indicator {
		color: var(--primary);
		font-size: 0.6rem;
		line-height: 1;
	}

	/* Mobile responsiveness */
	@media (max-width: 480px) {
		.notification-item {
			padding: 12px;
		}

		.notification-actions {
			opacity: 1; /* Always show on mobile */
		}

		.notification-title {
			font-size: 0.85rem;
		}

		.notification-message {
			font-size: 0.8rem;
		}
	}

	/* Focus styles for accessibility */
	.notification-item:focus {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}

	.action-btn:focus {
		outline: 2px solid var(--primary);
		outline-offset: 1px;
	}
</style>