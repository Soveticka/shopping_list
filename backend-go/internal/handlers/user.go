package handlers

import (
	"context"
	"fmt"
	"net/http"
	"shopping-list/internal/auth"
	"shopping-list/internal/database"
	"shopping-list/internal/models"
	"strings"

	"github.com/gin-gonic/gin"
)

type UserHandler struct {
	db *database.DB
}

func NewUserHandler(db *database.DB) *UserHandler {
	return &UserHandler{db: db}
}

func (h *UserHandler) GetCurrentUser(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var user models.User
	err := h.db.QueryRow(context.Background(),
		`SELECT id, username, email, default_list_id, authentik_sub, auth_provider, 
		 linked_at, last_oidc_login, created_at, updated_at 
		 FROM users WHERE id = $1`,
		userID).Scan(
		&user.ID, &user.Username, &user.Email, &user.DefaultListID,
		&user.AuthentikSub, &user.AuthProvider, &user.LinkedAt,
		&user.LastOIDCLogin, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) UpdateCurrentUser(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req struct {
		Username *string `json:"username,omitempty" validate:"omitempty,min=3,max=50"`
		Email    *string `json:"email,omitempty" validate:"omitempty,email"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Build dynamic update query
	updates := []string{}
	args := []interface{}{}
	argCount := 1

	if req.Username != nil {
		updates = append(updates, "username = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Username)
		argCount++
	}

	if req.Email != nil {
		updates = append(updates, "email = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Email)
		argCount++
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No fields to update"})
		return
	}

	// Add updated_at and user ID
	updates = append(updates, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, userID)

	query := fmt.Sprintf(
		`UPDATE users SET %s WHERE id = $%d 
		 RETURNING id, username, email, default_list_id, authentik_sub, auth_provider, 
		 linked_at, last_oidc_login, created_at, updated_at`,
		strings.Join(updates, ", "), argCount)

	var user models.User
	err := h.db.QueryRow(context.Background(), query, args...).Scan(
		&user.ID, &user.Username, &user.Email, &user.DefaultListID,
		&user.AuthentikSub, &user.AuthProvider, &user.LinkedAt,
		&user.LastOIDCLogin, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) DeleteCurrentUser(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Delete user (CASCADE will handle related data)
	result, err := h.db.Exec(context.Background(),
		"DELETE FROM users WHERE id = $1", userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user"})
		return
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
}

func (h *UserHandler) GetGroceryMemory(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *UserHandler) GetMemoryStats(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *UserHandler) GetNotifications(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *UserHandler) MarkNotificationRead(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *UserHandler) MarkAllNotificationsRead(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}