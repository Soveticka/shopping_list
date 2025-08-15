package handlers

import (
	"net/http"
	"shopping-list/internal/database"

	"github.com/gin-gonic/gin"
)

type ItemHandler struct {
	db *database.DB
}

func NewItemHandler(db *database.DB) *ItemHandler {
	return &ItemHandler{db: db}
}

func (h *ItemHandler) GetItems(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ItemHandler) CreateItem(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ItemHandler) GetItem(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ItemHandler) UpdateItem(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ItemHandler) DeleteItem(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *ItemHandler) BulkUpdateItems(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}