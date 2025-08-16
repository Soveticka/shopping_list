import { writable, derived } from 'svelte/store';
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

function createNotificationsStore() {
	const { subscribe, set, update } = writable<NotificationsState>(initialState);

	return {
		subscribe,

		async loadNotifications(limit = 50, offset = 0, unreadOnly = false) {
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
			set(initialState);
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