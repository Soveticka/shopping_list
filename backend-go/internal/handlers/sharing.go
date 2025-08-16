package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"shopping-list/internal/auth"
	"shopping-list/internal/database"
	"shopping-list/internal/models"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

type SharingHandler struct {
	db        *database.DB
	validator *validator.Validate
}

func NewSharingHandler(db *database.DB) *SharingHandler {
	return &SharingHandler{
		db:        db,
		validator: validator.New(),
	}
}

func (h *SharingHandler) ShareList(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
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

	var req models.ShareListRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify user owns the list
	var count int
	err = h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM shopping_lists WHERE id = $1 AND owner_id = $2",
		listID, userID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify list ownership"})
		return
	}

	if count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "List not found or access denied"})
		return
	}

	// Find target user by email
	var targetUserID int
	err = h.db.QueryRow(context.Background(),
		"SELECT id FROM users WHERE email = $1",
		req.Email).Scan(&targetUserID)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User with this email not found"})
		return
	}

	// Check if already shared with this user
	err = h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM list_shares WHERE list_id = $1 AND user_id = $2",
		listID, targetUserID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check existing shares"})
		return
	}

	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "List already shared with this user"})
		return
	}

	// Create share record
	var share models.ListShare
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO list_shares (list_id, user_id, permission, status)
		 VALUES ($1, $2, $3, 'pending')
		 RETURNING id, list_id, user_id, permission, status, shared_at`,
		listID, targetUserID, req.Permission).Scan(
		&share.ID, &share.ListID, &share.UserID, &share.Permission, &share.Status, &share.SharedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create share"})
		return
	}

	// Get user details for response
	err = h.db.QueryRow(context.Background(),
		"SELECT username, email FROM users WHERE id = $1",
		targetUserID).Scan(&share.Username, &share.Email)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get user details"})
		return
	}

	c.JSON(http.StatusCreated, share)
}

func (h *SharingHandler) GetListShares(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
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

	// Verify user owns the list
	var count int
	err = h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM shopping_lists WHERE id = $1 AND owner_id = $2",
		listID, userID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify list ownership"})
		return
	}

	if count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "List not found or access denied"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT ls.id, ls.list_id, ls.user_id, ls.permission, ls.status, ls.shared_at,
		 u.username, u.email
		 FROM list_shares ls
		 JOIN users u ON ls.user_id = u.id
		 WHERE ls.list_id = $1
		 ORDER BY ls.shared_at DESC`,
		listID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch shares"})
		return
	}
	defer rows.Close()

	var shares []models.ListShare
	for rows.Next() {
		var share models.ListShare
		err := rows.Scan(
			&share.ID, &share.ListID, &share.UserID, &share.Permission,
			&share.Status, &share.SharedAt, &share.Username, &share.Email)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan share"})
			return
		}

		shares = append(shares, share)
	}

	c.JSON(http.StatusOK, gin.H{"shares": shares})
}

func (h *SharingHandler) RemoveShare(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
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

	shareIDStr := c.Param("shareId")
	shareID, err := strconv.Atoi(shareIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid share ID"})
		return
	}

	// Verify user owns the list
	result, err := h.db.Exec(context.Background(),
		`DELETE FROM list_shares 
		 WHERE id = $1 AND list_id = $2 
		 AND list_id IN (SELECT id FROM shopping_lists WHERE owner_id = $3)`,
		shareID, listID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove share"})
		return
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Share not found or access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Share removed successfully"})
}

func (h *SharingHandler) GenerateShareToken(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
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

	// Verify user owns the list
	var count int
	err = h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM shopping_lists WHERE id = $1 AND owner_id = $2",
		listID, userID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify list ownership"})
		return
	}

	if count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "List not found or access denied"})
		return
	}

	// Generate random token
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	token := hex.EncodeToString(bytes)

	// Update list with share token
	_, err = h.db.Exec(context.Background(),
		`UPDATE shopping_lists 
		 SET share_token = $1, is_shared = true, updated_at = CURRENT_TIMESTAMP 
		 WHERE id = $2 AND owner_id = $3`,
		token, listID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update share token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"share_token": token})
}

func (h *SharingHandler) JoinByToken(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req struct {
		Token string `json:"token" validate:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find list by token
	var listID, ownerID int
	var listName string
	err := h.db.QueryRow(context.Background(),
		"SELECT id, owner_id, name FROM shopping_lists WHERE share_token = $1 AND is_shared = true",
		req.Token).Scan(&listID, &ownerID, &listName)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Invalid or expired share token"})
		return
	}

	// Check if user is the owner
	if ownerID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot join your own list"})
		return
	}

	// Check if already shared
	var count int
	err = h.db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM list_shares WHERE list_id = $1 AND user_id = $2",
		listID, userID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check existing shares"})
		return
	}

	if count > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Already have access to this list"})
		return
	}

	// Create share record with read permission
	var share models.ListShare
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO list_shares (list_id, user_id, permission, status)
		 VALUES ($1, $2, 'read', 'accepted')
		 RETURNING id, list_id, user_id, permission, status, shared_at`,
		listID, userID).Scan(
		&share.ID, &share.ListID, &share.UserID, &share.Permission, &share.Status, &share.SharedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to join list"})
		return
	}

	share.ListName = listName

	c.JSON(http.StatusCreated, gin.H{"share": share, "message": "Successfully joined list"})
}

func (h *SharingHandler) GetSharedLists(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT sl.id, sl.name, sl.owner_id, sl.is_shared, sl.created_at, sl.updated_at,
		 COUNT(sli.id) as item_count,
		 COUNT(CASE WHEN sli.completed = true THEN 1 END) as completed_count,
		 ls.permission,
		 false as is_owner
		 FROM shopping_lists sl
		 JOIN list_shares ls ON sl.id = ls.list_id
		 LEFT JOIN shopping_list_items sli ON sl.id = sli.list_id
		 WHERE ls.user_id = $1 AND ls.status = 'accepted'
		 GROUP BY sl.id, sl.name, sl.owner_id, sl.is_shared, sl.created_at, sl.updated_at, ls.permission
		 ORDER BY sl.updated_at DESC`,
		userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch shared lists"})
		return
	}
	defer rows.Close()

	var lists []models.ShoppingList
	for rows.Next() {
		var list models.ShoppingList
		err := rows.Scan(
			&list.ID, &list.Name, &list.OwnerID, &list.IsShared, &list.CreatedAt, &list.UpdatedAt,
			&list.ItemCount, &list.CompletedCount, &list.Permission, &list.IsOwner)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan list"})
			return
		}

		lists = append(lists, list)
	}

	c.JSON(http.StatusOK, gin.H{"shared_lists": lists})
}