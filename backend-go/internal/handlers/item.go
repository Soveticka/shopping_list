package handlers

import (
	"context"
	"fmt"
	"net/http"
	"shopping-list/internal/auth"
	"shopping-list/internal/database"
	"shopping-list/internal/models"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

type ItemHandler struct {
	db        *database.DB
	validator *validator.Validate
}

func NewItemHandler(db *database.DB) *ItemHandler {
	return &ItemHandler{
		db:        db,
		validator: validator.New(),
	}
}

func (h *ItemHandler) GetItems(c *gin.Context) {
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
		`SELECT id, list_id, name, quantity, category, priority, notes, completed, created_at, updated_at 
		 FROM shopping_list_items 
		 WHERE list_id = $1 
		 ORDER BY completed ASC, created_at DESC`,
		listID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch items"})
		return
	}
	defer rows.Close()

	var items []models.ShoppingListItem
	for rows.Next() {
		var item models.ShoppingListItem
		err := rows.Scan(
			&item.ID, &item.ListID, &item.Name, &item.Quantity, &item.Category,
			&item.Priority, &item.Notes, &item.Completed, &item.CreatedAt, &item.UpdatedAt)

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan item"})
			return
		}

		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *ItemHandler) CreateItem(c *gin.Context) {
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

	var req models.CreateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var item models.ShoppingListItem
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO shopping_list_items (list_id, name, quantity, category, priority, notes) 
		 VALUES ($1, $2, $3, $4, $5, $6) 
		 RETURNING id, list_id, name, quantity, category, priority, notes, completed, created_at, updated_at`,
		listID, req.Name, req.Quantity, req.Category, req.Priority, req.Notes).Scan(
		&item.ID, &item.ListID, &item.Name, &item.Quantity, &item.Category,
		&item.Priority, &item.Notes, &item.Completed, &item.CreatedAt, &item.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create item"})
		return
	}

	c.JSON(http.StatusCreated, item)
}

func (h *ItemHandler) GetItem(c *gin.Context) {
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

	itemIDStr := c.Param("itemId")
	itemID, err := strconv.Atoi(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item ID"})
		return
	}

	var item models.ShoppingListItem
	err = h.db.QueryRow(context.Background(),
		`SELECT sli.id, sli.list_id, sli.name, sli.quantity, sli.category, 
		 sli.priority, sli.notes, sli.completed, sli.created_at, sli.updated_at
		 FROM shopping_list_items sli
		 JOIN shopping_lists sl ON sli.list_id = sl.id
		 WHERE sli.id = $1 AND sli.list_id = $2 AND sl.owner_id = $3`,
		itemID, listID, userID).Scan(
		&item.ID, &item.ListID, &item.Name, &item.Quantity, &item.Category,
		&item.Priority, &item.Notes, &item.Completed, &item.CreatedAt, &item.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
		return
	}

	c.JSON(http.StatusOK, item)
}

func (h *ItemHandler) UpdateItem(c *gin.Context) {
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

	itemIDStr := c.Param("itemId")
	itemID, err := strconv.Atoi(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item ID"})
		return
	}

	var req models.UpdateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build dynamic update query
	updates := []string{}
	args := []interface{}{}
	argCount := 1

	if req.Name != nil {
		updates = append(updates, "name = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Name)
		argCount++
	}

	if req.Quantity != nil {
		updates = append(updates, "quantity = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Quantity)
		argCount++
	}

	if req.Category != nil {
		updates = append(updates, "category = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Category)
		argCount++
	}

	if req.Priority != nil {
		updates = append(updates, "priority = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Priority)
		argCount++
	}

	if req.Notes != nil {
		updates = append(updates, "notes = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Notes)
		argCount++
	}

	if req.Completed != nil {
		updates = append(updates, "completed = $"+fmt.Sprintf("%d", argCount))
		args = append(args, *req.Completed)
		argCount++
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No fields to update"})
		return
	}

	// Add updated_at, item ID, list ID, and user ID
	updates = append(updates, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, itemID, listID, userID)

	query := fmt.Sprintf(
		`UPDATE shopping_list_items SET %s 
		 WHERE id = $%d AND list_id = $%d 
		 AND list_id IN (SELECT id FROM shopping_lists WHERE owner_id = $%d) 
		 RETURNING id, list_id, name, quantity, category, priority, notes, completed, created_at, updated_at`,
		strings.Join(updates, ", "), argCount, argCount+1, argCount+2)

	var item models.ShoppingListItem
	err = h.db.QueryRow(context.Background(), query, args...).Scan(
		&item.ID, &item.ListID, &item.Name, &item.Quantity, &item.Category,
		&item.Priority, &item.Notes, &item.Completed, &item.CreatedAt, &item.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Item not found or access denied"})
		return
	}

	c.JSON(http.StatusOK, item)
}

func (h *ItemHandler) DeleteItem(c *gin.Context) {
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

	itemIDStr := c.Param("itemId")
	itemID, err := strconv.Atoi(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item ID"})
		return
	}

	result, err := h.db.Exec(context.Background(),
		`DELETE FROM shopping_list_items 
		 WHERE id = $1 AND list_id = $2 
		 AND list_id IN (SELECT id FROM shopping_lists WHERE owner_id = $3)`,
		itemID, listID, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete item"})
		return
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Item not found or access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item deleted successfully"})
}

func (h *ItemHandler) BulkUpdateItems(c *gin.Context) {
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

	var req struct {
		Items []struct {
			ID        int                       `json:"id" validate:"required"`
			Updates   models.UpdateItemRequest  `json:"updates"`
		} `json:"items" validate:"required,dive"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updatedItems := []models.ShoppingListItem{}
	for _, itemUpdate := range req.Items {
		// Build dynamic update query for each item
		updates := []string{}
		args := []interface{}{}
		argCount := 1

		if itemUpdate.Updates.Name != nil {
			updates = append(updates, "name = $"+fmt.Sprintf("%d", argCount))
			args = append(args, *itemUpdate.Updates.Name)
			argCount++
		}

		if itemUpdate.Updates.Quantity != nil {
			updates = append(updates, "quantity = $"+fmt.Sprintf("%d", argCount))
			args = append(args, *itemUpdate.Updates.Quantity)
			argCount++
		}

		if itemUpdate.Updates.Category != nil {
			updates = append(updates, "category = $"+fmt.Sprintf("%d", argCount))
			args = append(args, *itemUpdate.Updates.Category)
			argCount++
		}

		if itemUpdate.Updates.Priority != nil {
			updates = append(updates, "priority = $"+fmt.Sprintf("%d", argCount))
			args = append(args, *itemUpdate.Updates.Priority)
			argCount++
		}

		if itemUpdate.Updates.Notes != nil {
			updates = append(updates, "notes = $"+fmt.Sprintf("%d", argCount))
			args = append(args, *itemUpdate.Updates.Notes)
			argCount++
		}

		if itemUpdate.Updates.Completed != nil {
			updates = append(updates, "completed = $"+fmt.Sprintf("%d", argCount))
			args = append(args, *itemUpdate.Updates.Completed)
			argCount++
		}

		// Skip items with no updates
		if len(updates) == 0 {
			continue
		}

		// Add updated_at, item ID, and list ID
		updates = append(updates, "updated_at = CURRENT_TIMESTAMP")
		args = append(args, itemUpdate.ID, listID)

		query := fmt.Sprintf(
			`UPDATE shopping_list_items SET %s 
			 WHERE id = $%d AND list_id = $%d 
			 RETURNING id, list_id, name, quantity, category, priority, notes, completed, created_at, updated_at`,
			strings.Join(updates, ", "), argCount, argCount+1)

		var item models.ShoppingListItem
		err = h.db.QueryRow(context.Background(), query, args...).Scan(
			&item.ID, &item.ListID, &item.Name, &item.Quantity, &item.Category,
			&item.Priority, &item.Notes, &item.Completed, &item.CreatedAt, &item.UpdatedAt)

		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Failed to update item %d", itemUpdate.ID)})
			return
		}

		updatedItems = append(updatedItems, item)
	}

	c.JSON(http.StatusOK, gin.H{"updated_items": updatedItems})
}