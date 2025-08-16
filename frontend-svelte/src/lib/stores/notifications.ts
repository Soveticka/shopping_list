import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { api } from '../utils/api';

export interface Notification {
	id: number;
	user_id: number;
	type: string;
	title: string;
	message: string;
	data?: any;
	is_read: boolean;
	created_at: string;
}

export interface CreateNotificationRequest {
	user_id: number;
	type: string;
	title: string;
	message: string;
	data?: any;
}

export interface MarkReadRequest {
	is_read: boolean;
}

export interface NotificationsResponse {
	notifications: Notification[];
	unread_count: number;
	total: number;
}

interface NotificationsState {
	notifications: Notification[];
	unreadCount: number;
	loading: boolean;
	error: string | null;
}

const initialState: NotificationsState = {
	notifications: [],
	unreadCount: 0,
	loading: false,
	error: null,
};

// Cache management for notifications
interface NotificationsCacheEntry {
	data: any;
	timestamp: number;
	expires: number;
}

class NotificationsCache {
	private cache = new Map<string, NotificationsCacheEntry>();
	private readonly defaultTTL = 2 * 60 * 1000; // 2 minutes (shorter for notifications)

	set(key: string, data: any, ttl = this.defaultTTL) {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			expires: Date.now() + ttl
		});
	}

	get(key: string): any | null {
		const entry = this.cache.get(key);
		if (!entry) return null;
		
		if (Date.now() > entry.expires) {
			this.cache.delete(key);
			return null;
		}
		
		return entry.data;
	}

	invalidate(pattern?: string) {
		if (!pattern) {
			this.cache.clear();
			return;
		}
		
		for (const key of this.cache.keys()) {
			if (key.includes(pattern)) {
				this.cache.delete(key);
			}
		}
	}

	cleanup() {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expires) {
				this.cache.delete(key);
			}
		}
	}
}

const notificationsCache = new NotificationsCache();

function createNotificationsStore() {
	const { subscribe, set, update } = writable<NotificationsState>(initialState);

	// Listen for auth logout events to clear cache
	if (browser) {
		window.addEventListener('auth:logout', () => {
			notificationsCache.invalidate();
			set(initialState);
		});

		// Periodic cache cleanup every 2 minutes
		setInterval(() => {
			notificationsCache.cleanup();
		}, 2 * 60 * 1000);
	}

	return {
		subscribe,

		async loadNotifications(limit = 50, offset = 0, unreadOnly = false) {
			// Check cache first (only for first page)
			if (offset === 0) {
				const cacheKey = `notifications-${limit}-${unreadOnly ? 'unread' : 'all'}`;
				const cached = notificationsCache.get(cacheKey);
				if (cached) {
					update(state => ({
						...state,
						notifications: cached.notifications || [],
						unreadCount: cached.unread_count || 0,
						loading: false
					}));
					return;
				}
			}

			update(state => ({ ...state, loading: true, error: null }));
			
			try {
				const params = new URLSearchParams({
					limit: limit.toString(),
					offset: offset.toString(),
				});
				
				if (unreadOnly) {
					params.set('unread_only', 'true');
				}

				const response = await api.get(`/notifications?${params.toString()}`);
				const data: NotificationsResponse = response;

				// Cache first page results
				if (offset === 0) {
					const cacheKey = `notifications-${limit}-${unreadOnly ? 'unread' : 'all'}`;
					notificationsCache.set(cacheKey, data);
				}

				update(state => ({
					...state,
					notifications: offset === 0 ? data.notifications : [...state.notifications, ...data.notifications],
					unreadCount: data.unread_count,
					loading: false,
				}));
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to load notifications';
				update(state => ({ ...state, loading: false, error: errorMessage }));
				throw error;
			}
		},

		async getNotification(id: number): Promise<Notification> {
			update(state => ({ ...state, error: null }));
			
			try {
				const notification = await api.get(`/notifications/${id}`);
				return notification;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to get notification';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async createNotification(request: CreateNotificationRequest): Promise<Notification> {
			update(state => ({ ...state, error: null }));
			
			try {
				const notification = await api.post('/notifications', request);
				
				// Invalidate cache
				notificationsCache.invalidate();
				
				// Add to local state
				update(state => ({
					...state,
					notifications: [notification, ...state.notifications],
					unreadCount: state.unreadCount + 1,
				}));
				
				return notification;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to create notification';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async markAsRead(id: number, isRead: boolean = true) {
			update(state => ({ ...state, error: null }));
			
			try {
				await api.put(`/notifications/${id}/read`, { is_read: isRead });
				
				// Invalidate cache
				notificationsCache.invalidate();
				
				// Update local state
				update(state => {
					const notifications = state.notifications.map(n => 
						n.id === id ? { ...n, is_read: isRead } : n
					);
					
					const unreadCount = isRead 
						? Math.max(0, state.unreadCount - 1)
						: state.unreadCount + 1;
						
					return {
						...state,
						notifications,
						unreadCount,
					};
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to mark notification';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async markAllAsRead() {
			update(state => ({ ...state, error: null }));
			
			try {
				await api.post('/notifications/mark-all-read');
				
				// Invalidate cache
				notificationsCache.invalidate();
				
				// Update local state
				update(state => ({
					...state,
					notifications: state.notifications.map(n => ({ ...n, is_read: true })),
					unreadCount: 0,
				}));
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to mark all notifications as read';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async deleteNotification(id: number) {
			update(state => ({ ...state, error: null }));
			
			try {
				await api.delete(`/notifications/${id}`);
				
				// Invalidate cache
				notificationsCache.invalidate();
				
				// Remove from local state
				update(state => {
					const notification = state.notifications.find(n => n.id === id);
					const notifications = state.notifications.filter(n => n.id !== id);
					const unreadCount = notification && !notification.is_read 
						? Math.max(0, state.unreadCount - 1)
						: state.unreadCount;
						
					return {
						...state,
						notifications,
						unreadCount,
					};
				});
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to delete notification';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		async getUnreadCount(): Promise<number> {
			try {
				const response = await api.get('/notifications/unread-count');
				const count = response.unread_count;
				
				update(state => ({ ...state, unreadCount: count }));
				return count;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Failed to get unread count';
				update(state => ({ ...state, error: errorMessage }));
				throw error;
			}
		},

		clearError() {
			update(state => ({ ...state, error: null }));
		},

		reset() {
			// Clear cache
			notificationsCache.invalidate();
			set(initialState);
		},

		// WebSocket handler
		handleWebSocketNotification(notificationData: any) {
			// Add new notification to the beginning of the list
			update(state => ({
				...state,
				notifications: [notificationData, ...state.notifications],
				unreadCount: state.unreadCount + 1
			}));
		}
	};
}

export const notificationsStore = createNotificationsStore();

// Derived stores for common use cases
export const unreadNotifications = derived(
	notificationsStore,
	$store => $store.notifications.filter(n => !n.is_read)
);

export const hasUnreadNotifications = derived(
	notificationsStore,
	$store => $store.unreadCount > 0
);

export const notificationsByType = derived(
	notificationsStore,
	$store => {
		const byType: Record<string, Notification[]> = {};
		for (const notification of $store.notifications) {
			if (!byType[notification.type]) {
				byType[notification.type] = [];
			}
			byType[notification.type].push(notification);
		}
		return byType;
	}
);