package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"shopping-list/internal/auth"
	"shopping-list/internal/websocket"
)

type WebSocketHandler struct {
	hub *websocket.Hub
}

func NewWebSocketHandler(hub *websocket.Hub) *WebSocketHandler {
	return &WebSocketHandler{hub: hub}
}

// HandleWebSocket upgrades HTTP connection to WebSocket
func (h *WebSocketHandler) HandleWebSocket(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Upgrade connection to WebSocket
	h.hub.ServeWS(c, userID)
}

// GetOnlineUsers returns list of currently online users
func (h *WebSocketHandler) GetOnlineUsers(c *gin.Context) {
	_, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	onlineUsers := h.hub.GetOnlineUsers()
	
	c.JSON(http.StatusOK, gin.H{
		"online_users": onlineUsers,
		"count": len(onlineUsers),
	})
}

// BroadcastToList sends a message to all users subscribed to a list
func (h *WebSocketHandler) BroadcastToList(c *gin.Context) {
	_, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	listIDStr := c.Param("id")
	listID, err := strconv.Atoi(listIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid list ID"})
		return
	}

	var payload struct {
		Type string      `json:"type" binding:"required"`
		Data interface{} `json:"data"`
	}

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Check if user has permission to broadcast to this list
	// For now, we'll allow any authenticated user

	switch payload.Type {
	case "list_update":
		h.hub.BroadcastListUpdate(listID, payload.Data)
	case "item_update":
		h.hub.BroadcastItemUpdate(listID, payload.Data)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message type"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Broadcast sent successfully"})
}

// BroadcastNotification sends a notification to a specific user
func (h *WebSocketHandler) BroadcastNotification(c *gin.Context) {
	_, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	targetUserIDStr := c.Param("userId")
	targetUserID, err := strconv.Atoi(targetUserIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var payload struct {
		Data interface{} `json:"data"`
	}

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// TODO: Check if user has permission to send notifications to target user
	// For now, we'll allow any authenticated user

	h.hub.BroadcastNotification(targetUserID, payload.Data)

	c.JSON(http.StatusOK, gin.H{"message": "Notification sent successfully"})
}