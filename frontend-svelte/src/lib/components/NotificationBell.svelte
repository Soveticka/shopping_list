<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { notificationsStore, hasUnreadNotifications } from '$lib/stores/notifications';
	import NotificationPanel from './NotificationPanel.svelte';

	export let showPanel = false;
	
	let unreadCount = 0;
	let mounted = false;
	let refreshInterval: NodeJS.Timeout;

	// Subscribe to unread count
	$: unreadCount = $notificationsStore.unreadCount;
	$: hasUnread = $hasUnreadNotifications;

	onMount(async () => {
		mounted = true;
		
		// Load initial unread count
		try {
			await notificationsStore.getUnreadCount();
		} catch (err) {
			console.error('Failed to load unread count:', err);
		}

		// Set up periodic refresh for unread count (every 30 seconds)
		refreshInterval = setInterval(async () => {
			if (!showPanel) { // Only refresh when panel is not open
				try {
					await notificationsStore.getUnreadCount();
				} catch (err) {
					console.error('Failed to refresh unread count:', err);
				}
			}
		}, 30000);
	});

	onDestroy(() => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
	});

	function togglePanel() {
		showPanel = !showPanel;
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			togglePanel();
		}
	}

	// Format unread count display
	function formatUnreadCount(count: number): string {
		if (count === 0) return '';
		if (count > 99) return '99+';
		return count.toString();
	}
</script>

<div class="notification-bell-container">
	<button
		class="notification-bell"
		class:has-notifications={hasUnread}
		class:active={showPanel}
		type="button"
		title="Notifikace {unreadCount > 0 ? `(${unreadCount} nepřečtených)` : ''}"
		aria-label="Otevřít panel notifikací"
		aria-expanded={showPanel}
		on:click={togglePanel}
		on:keypress={handleKeyPress}
	>
		<span class="bell-icon">🔔</span>
		{#if unreadCount > 0}
			<span class="notification-badge" aria-label="{unreadCount} nepřečtených notifikací">
				{formatUnreadCount(unreadCount)}
			</span>
		{/if}
	</button>

	<NotificationPanel bind:isOpen={showPanel} />
</div>

<style>
	.notification-bell-container {
		position: relative;
	}

	.notification-bell {
		position: relative;
		background: none;
		border: none;
		padding: 8px;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 40px;
		height: 40px;
	}

	.notification-bell:hover {
		background: var(--background-hover);
	}

	.notification-bell.active {
		background: var(--primary-light);
		color: var(--primary);
	}

	.notification-bell.has-notifications {
		animation: gentle-pulse 2s ease-in-out infinite;
	}

	.bell-icon {
		font-size: 1.2rem;
		transition: transform 0.2s ease;
		filter: grayscale(0.3);
	}

	.notification-bell:hover .bell-icon {
		transform: rotate(15deg);
		filter: none;
	}

	.notification-bell.has-notifications .bell-icon {
		filter: none;
	}

	.notification-badge {
		position: absolute;
		top: 2px;
		right: 2px;
		background: var(--danger);
		color: white;
		border-radius: 10px;
		min-width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1;
		padding: 0 4px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		border: 2px solid var(--surface);
	}

	/* Subtle pulse animation for unread notifications */
	@keyframes gentle-pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.8;
		}
	}

	/* Focus styles for accessibility */
	.notification-bell:focus {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* Mobile responsiveness */
	@media (max-width: 480px) {
		.notification-bell {
			min-width: 36px;
			height: 36px;
			padding: 6px;
		}

		.bell-icon {
			font-size: 1.1rem;
		}

		.notification-badge {
			top: 1px;
			right: 1px;
			min-width: 16px;
			height: 16px;
			font-size: 0.65rem;
		}
	}

	/* High contrast mode support */
	@media (prefers-contrast: high) {
		.notification-bell {
			border: 1px solid var(--text-secondary);
		}

		.notification-bell:hover {
			border-color: var(--primary);
		}
	}

	/* Reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.notification-bell.has-notifications {
			animation: none;
		}

		.bell-icon {
			transition: none;
		}

		.notification-bell:hover .bell-icon {
			transform: none;
		}
	}
</style>