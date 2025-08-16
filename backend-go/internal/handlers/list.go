package handlers

import (
	"context"
	"net/http"
	"shopping-list/internal/auth"
	"shopping-list/internal/database"
	"shopping-list/internal/models"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

type ListHandler struct {
	db        *database.DB
	validator *validator.Validate
}

func NewListHandler(db *database.DB) *ListHandler {
	return &ListHandler{
		db:        db,
		validator: validator.New(),
	}
}

func (h *ListHandler) GetLists(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	rows, err := h.db.Query(context.Background(),
		`SELECT sl.id, sl.name, sl.owner_id, sl.is_shared, sl.share_token, 
		 sl.created_at, sl.updated_at,
		 COUNT(sli.id) as item_count,
		 COUNT(CASE WHEN sli.completed = true THEN 1 END) as completed_count,
		 CASE WHEN sl.owner_id = $1 THEN 'admin' ELSE 'read' END as permission,
		 CASE WHEN sl.owner_id = $1 THEN true ELSE false END as is_owner
		 FROM shopping_lists sl
		 LEFT JOIN shopping_list_items sli ON sl.id = sli.list_id
		 WHERE sl.owner_id = $1 
		 GROUP BY sl.id, sl.name, sl.owner_id, sl.is_shared, sl.share_token, sl.created_at, sl.updated_at
		 ORDER BY sl.updated_at DESC`,
		userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch lists"})
		return
	}
	defer rows.Close()

	var lists []models.ShoppingList
	for rows.Next() {
		var list models.ShoppingList
		err := rows.Scan(
			&list.ID, &list.Name, &list.OwnerID, &list.IsShared, &list.ShareToken,
			&list.CreatedAt, &list.UpdatedAt, &list.ItemCount, &list.CompletedCount,
			&list.Permission, &list.IsOwner)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan list"})
			return
		}

		lists = append(lists, list)
	}

	c.JSON(http.StatusOK, gin.H{"lists": lists})
}

func (h *ListHandler) CreateList(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req models.CreateListRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var list models.ShoppingList
	err := h.db.QueryRow(context.Background(),
		`INSERT INTO shopping_lists (name, owner_id) 
		 VALUES ($1, $2) 
		 RETURNING id, name, owner_id, is_shared, share_token, created_at, updated_at`,
		req.Name, userID).Scan(
		&list.ID, &list.Name, &list.OwnerID, &list.IsShared,
		&list.ShareToken, &list.CreatedAt, &list.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create list"})
		return
	}

	// Set computed fields
	list.ItemCount = 0
	list.CompletedCount = 0
	list.Permission = "admin"
	list.IsOwner = true

	c.JSON(http.StatusCreated, list)
}

func (h *ListHandler) GetList(c *gin.Context) {
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

	var list models.ShoppingList
	err = h.db.QueryRow(context.Background(),
		`SELECT sl.id, sl.name, sl.owner_id, sl.is_shared, sl.share_token,
		 sl.created_at, sl.updated_at,
		 COUNT(sli.id) as item_count,
		 COUNT(CASE WHEN sli.completed = true THEN 1 END) as completed_count,
		 CASE WHEN sl.owner_id = $2 THEN 'admin' ELSE 'read' END as permission,
		 CASE WHEN sl.owner_id = $2 THEN true ELSE false END as is_owner
		 FROM shopping_lists sl
		 LEFT JOIN shopping_list_items sli ON sl.id = sli.list_id
		 WHERE sl.id = $1 AND sl.owner_id = $2
		 GROUP BY sl.id, sl.name, sl.owner_id, sl.is_shared, sl.share_token, sl.created_at, sl.updated_at`,
		listID, userID).Scan(
		&list.ID, &list.Name, &list.OwnerID, &list.IsShared, &list.ShareToken,
		&list.CreatedAt, &list.UpdatedAt, &list.ItemCount, &list.CompletedCount,
		&list.Permission, &list.IsOwner)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "List not found"})
		return
	}

	c.JSON(http.StatusOK, list)
}

func (h *ListHandler) UpdateList(c *gin.Context) {
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

	var req models.UpdateListRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var list models.ShoppingList
	err = h.db.QueryRow(context.Background(),
		`UPDATE shopping_lists 
		 SET name = $1, updated_at = CURRENT_TIMESTAMP 
		 WHERE id = $2 AND owner_id = $3 
		 RETURNING id, name, owner_id, is_shared, share_token, created_at, updated_at`,
		req.Name, listID, userID).Scan(
		&list.ID, &list.Name, &list.OwnerID, &list.IsShared,
		&list.ShareToken, &list.CreatedAt, &list.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "List not found or access denied"})
		return
	}

	// Set computed fields
	list.Permission = "admin"
	list.IsOwner = true

	c.JSON(http.StatusOK, list)
}

func (h *ListHandler) DeleteList(c *gin.Context) {
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

	result, err := h.db.Exec(context.Background(),
		"DELETE FROM shopping_lists WHERE id = $1 AND owner_id = $2",
		listID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete list"})
		return
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "List not found or access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "List deleted successfully"})
}

func (h *ListHandler) SetDefaultList(c *gin.Context) {
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

	// First verify that the user owns the list
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

	// Update user's default list
	_, err = h.db.Exec(context.Background(),
		"UPDATE users SET default_list_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
		listID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to set default list"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Default list updated successfully"})
}

func (h *ListHandler) ShareList(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ListHandler) GetListShares(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ListHandler) RemoveShare(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ListHandler) RespondToShare(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}