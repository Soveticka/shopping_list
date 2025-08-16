package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"shopping-list/internal/auth"
	"shopping-list/internal/database"
)

type NotificationHandler struct {
	db *database.DB
}

func NewNotificationHandler(db *database.DB) *NotificationHandler {
	return &NotificationHandler{db: db}
}

type Notification struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	Type      string    `json:"type"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Data      *string   `json:"data,omitempty"`
	IsRead    bool      `json:"is_read"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateNotificationRequest struct {
	UserID  int     `json:"user_id" binding:"required"`
	Type    string  `json:"type" binding:"required"`
	Title   string  `json:"title" binding:"required"`
	Message string  `json:"message" binding:"required"`
	Data    *string `json:"data,omitempty"`
}

type MarkReadRequest struct {
	IsRead bool `json:"is_read" binding:"required"`
}

// GetNotifications retrieves notifications for the authenticated user
func (h *NotificationHandler) GetNotifications(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Parse query parameters
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	unreadOnly := c.Query("unread_only") == "true"

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 100 {
		limit = 50
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	// Build query
	query := `
		SELECT id, user_id, type, title, message, data, is_read, created_at
		FROM notifications
		WHERE user_id = $1`
	args := []interface{}{userID}
	argCount := 2

	if unreadOnly {
		query += " AND is_read = false"
	}

	query += " ORDER BY created_at DESC LIMIT $" + strconv.Itoa(argCount) + " OFFSET $" + strconv.Itoa(argCount+1)
	args = append(args, limit, offset)

	rows, err := h.db.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query notifications"})
		return
	}
	defer rows.Close()

	var notifications []Notification
	for rows.Next() {
		var notification Notification
		err := rows.Scan(
			&notification.ID,
			&notification.UserID,
			&notification.Type,
			&notification.Title,
			&notification.Message,
			&notification.Data,
			&notification.IsRead,
			&notification.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan notification"})
			return
		}
		notifications = append(notifications, notification)
	}

	if notifications == nil {
		notifications = []Notification{}
	}

	// Get unread count
	var unreadCount int
	err = h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
		userID).Scan(&unreadCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get unread count"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"unread_count":  unreadCount,
		"total":         len(notifications),
	})
}

// GetNotification retrieves a specific notification
func (h *NotificationHandler) GetNotification(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	notificationIDStr := c.Param("id")
	notificationID, err := strconv.Atoi(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}

	var notification Notification
	err = h.db.QueryRow(context.Background(),
		`SELECT id, user_id, type, title, message, data, is_read, created_at
		 FROM notifications
		 WHERE id = $1 AND user_id = $2`,
		notificationID, userID).Scan(
		&notification.ID,
		&notification.UserID,
		&notification.Type,
		&notification.Title,
		&notification.Message,
		&notification.Data,
		&notification.IsRead,
		&notification.CreatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Notification not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get notification"})
		return
	}

	c.JSON(http.StatusOK, notification)
}

// CreateNotification creates a new notification (admin/system use)
func (h *NotificationHandler) CreateNotification(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req CreateNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// For now, only allow users to create notifications for themselves
	if req.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Cannot create notifications for other users"})
		return
	}

	var notificationID int
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO notifications (user_id, type, title, message, data, is_read, created_at)
		 VALUES ($1, $2, $3, $4, $5, false, NOW())
		 RETURNING id`,
		req.UserID, req.Type, req.Title, req.Message, req.Data).Scan(&notificationID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create notification"})
		return
	}

	// Fetch the created notification
	var notification Notification
	err = h.db.QueryRow(context.Background(),
		`SELECT id, user_id, type, title, message, data, is_read, created_at
		 FROM notifications
		 WHERE id = $1`,
		notificationID).Scan(
		&notification.ID,
		&notification.UserID,
		&notification.Type,
		&notification.Title,
		&notification.Message,
		&notification.Data,
		&notification.IsRead,
		&notification.CreatedAt,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch created notification"})
		return
	}

	c.JSON(http.StatusCreated, notification)
}

// MarkAsRead marks a notification as read/unread
func (h *NotificationHandler) MarkAsRead(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	notificationIDStr := c.Param("id")
	notificationID, err := strconv.Atoi(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}

	var req MarkReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if notification belongs to user
	var exists_check bool
	err = h.db.QueryRow(context.Background(),
		"SELECT EXISTS(SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2)",
		notificationID, userID).Scan(&exists_check)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check notification ownership"})
		return
	}

	if !exists_check {
		c.JSON(http.StatusNotFound, gin.H{"error": "Notification not found"})
		return
	}

	// Update the notification
	_, err = h.db.Exec(context.Background(),
		"UPDATE notifications SET is_read = $1 WHERE id = $2",
		req.IsRead, notificationID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update notification"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Notification updated successfully"})
}

// MarkAllAsRead marks all notifications for a user as read
func (h *NotificationHandler) MarkAllAsRead(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	_, err := h.db.Exec(context.Background(),
		"UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
		userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark notifications as read"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "All notifications marked as read"})
}

// DeleteNotification deletes a specific notification
func (h *NotificationHandler) DeleteNotification(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	notificationIDStr := c.Param("id")
	notificationID, err := strconv.Atoi(notificationIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid notification ID"})
		return
	}

	result, err := h.db.Exec(context.Background(),
		"DELETE FROM notifications WHERE id = $1 AND user_id = $2",
		notificationID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete notification"})
		return
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Notification not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Notification deleted successfully"})
}

// GetUnreadCount gets the count of unread notifications for the user
func (h *NotificationHandler) GetUnreadCount(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var unreadCount int
	err := h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
		userID).Scan(&unreadCount)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get unread count"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"unread_count": unreadCount})
}

// Helper function to create a notification (for internal use)
func (h *NotificationHandler) CreateNotificationForUser(userID int, notificationType, title, message string, data *string) error {
	_, err := h.db.Exec(context.Background(),
		`INSERT INTO notifications (user_id, type, title, message, data, is_read, created_at)
		 VALUES ($1, $2, $3, $4, $5, false, NOW())`,
		userID, notificationType, title, message, data)
	return err
}