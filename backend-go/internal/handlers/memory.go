package handlers

import (
	"context"
	"net/http"
	"shopping-list/internal/auth"
	"shopping-list/internal/database"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type MemoryHandler struct {
	db *database.DB
}

func NewMemoryHandler(db *database.DB) *MemoryHandler {
	return &MemoryHandler{db: db}
}

type MemoryItem struct {
	Name      string `json:"name"`
	Category  string `json:"category"`
	Frequency int    `json:"frequency"`
	LastUsed  string `json:"last_used"`
}

type MemoryStats struct {
	TotalItems      int               `json:"total_items"`
	TotalCategories int               `json:"total_categories"`
	MostUsedItems   []MemoryItem      `json:"most_used_items"`
	Categories      map[string]int    `json:"categories"`
}

func (h *MemoryHandler) GetMemory(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	query := c.Query("q")
	category := c.Query("category")
	limitStr := c.DefaultQuery("limit", "20")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 20
	}

	// Build the SQL query based on filters
	var sqlQuery string
	var args []interface{}

	if query != "" && category != "" {
		sqlQuery = `
			SELECT DISTINCT ON (sli.name) sli.name, sli.category, COUNT(*) as frequency, 
			       MAX(sli.created_at)::text as last_used
			FROM shopping_list_items sli
			JOIN shopping_lists sl ON sli.list_id = sl.id
			WHERE sl.owner_id = $1 
			  AND LOWER(sli.name) LIKE LOWER($2)
			  AND LOWER(sli.category) = LOWER($3)
			GROUP BY sli.name, sli.category
			ORDER BY sli.name, COUNT(*) DESC, MAX(sli.created_at) DESC
			LIMIT $4`
		args = []interface{}{userID, "%" + strings.ToLower(query) + "%", strings.ToLower(category), limit}
	} else if query != "" {
		sqlQuery = `
			SELECT DISTINCT ON (sli.name) sli.name, sli.category, COUNT(*) as frequency, 
			       MAX(sli.created_at)::text as last_used
			FROM shopping_list_items sli
			JOIN shopping_lists sl ON sli.list_id = sl.id
			WHERE sl.owner_id = $1 
			  AND LOWER(sli.name) LIKE LOWER($2)
			GROUP BY sli.name, sli.category
			ORDER BY sli.name, COUNT(*) DESC, MAX(sli.created_at) DESC
			LIMIT $3`
		args = []interface{}{userID, "%" + strings.ToLower(query) + "%", limit}
	} else if category != "" {
		sqlQuery = `
			SELECT DISTINCT ON (sli.name) sli.name, sli.category, COUNT(*) as frequency, 
			       MAX(sli.created_at)::text as last_used
			FROM shopping_list_items sli
			JOIN shopping_lists sl ON sli.list_id = sl.id
			WHERE sl.owner_id = $1 
			  AND LOWER(sli.category) = LOWER($2)
			GROUP BY sli.name, sli.category
			ORDER BY sli.name, COUNT(*) DESC, MAX(sli.created_at) DESC
			LIMIT $3`
		args = []interface{}{userID, strings.ToLower(category), limit}
	} else {
		sqlQuery = `
			SELECT DISTINCT ON (sli.name) sli.name, sli.category, COUNT(*) as frequency, 
			       MAX(sli.created_at)::text as last_used
			FROM shopping_list_items sli
			JOIN shopping_lists sl ON sli.list_id = sl.id
			WHERE sl.owner_id = $1
			GROUP BY sli.name, sli.category
			ORDER BY sli.name, COUNT(*) DESC, MAX(sli.created_at) DESC
			LIMIT $2`
		args = []interface{}{userID, limit}
	}

	rows, err := h.db.Query(context.Background(), sqlQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch memory items"})
		return
	}
	defer rows.Close()

	var items []MemoryItem
	for rows.Next() {
		var item MemoryItem
		err := rows.Scan(&item.Name, &item.Category, &item.Frequency, &item.LastUsed)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan memory item"})
			return
		}
		items = append(items, item)
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *MemoryHandler) GetCategories(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	query := c.Query("q")
	limitStr := c.DefaultQuery("limit", "20")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 20
	}

	var sqlQuery string
	var args []interface{}

	if query != "" {
		sqlQuery = `
			SELECT category, COUNT(*) as frequency
			FROM shopping_list_items sli
			JOIN shopping_lists sl ON sli.list_id = sl.id
			WHERE sl.owner_id = $1 
			  AND LOWER(sli.category) LIKE LOWER($2)
			GROUP BY category
			ORDER BY frequency DESC, category ASC
			LIMIT $3`
		args = []interface{}{userID, "%" + strings.ToLower(query) + "%", limit}
	} else {
		sqlQuery = `
			SELECT category, COUNT(*) as frequency
			FROM shopping_list_items sli
			JOIN shopping_lists sl ON sli.list_id = sl.id
			WHERE sl.owner_id = $1
			GROUP BY category
			ORDER BY frequency DESC, category ASC
			LIMIT $2`
		args = []interface{}{userID, limit}
	}

	rows, err := h.db.Query(context.Background(), sqlQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}
	defer rows.Close()

	type CategoryItem struct {
		Name      string `json:"name"`
		Frequency int    `json:"frequency"`
	}

	var categories []CategoryItem
	for rows.Next() {
		var cat CategoryItem
		err := rows.Scan(&cat.Name, &cat.Frequency)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan category"})
			return
		}
		categories = append(categories, cat)
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

func (h *MemoryHandler) GetMemoryStats(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	stats := MemoryStats{
		Categories: make(map[string]int),
	}

	// Get total unique items count
	err := h.db.QueryRow(context.Background(),
		`SELECT COUNT(DISTINCT name) 
		 FROM shopping_list_items sli
		 JOIN shopping_lists sl ON sli.list_id = sl.id
		 WHERE sl.owner_id = $1`,
		userID).Scan(&stats.TotalItems)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get total items"})
		return
	}

	// Get total categories count
	err = h.db.QueryRow(context.Background(),
		`SELECT COUNT(DISTINCT category)
		 FROM shopping_list_items sli
		 JOIN shopping_lists sl ON sli.list_id = sl.id
		 WHERE sl.owner_id = $1`,
		userID).Scan(&stats.TotalCategories)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get total categories"})
		return
	}

	// Get top 10 most used items
	rows, err := h.db.Query(context.Background(),
		`SELECT DISTINCT ON (sli.name) sli.name, sli.category, COUNT(*) as frequency, 
		 MAX(sli.created_at)::text as last_used
		 FROM shopping_list_items sli
		 JOIN shopping_lists sl ON sli.list_id = sl.id
		 WHERE sl.owner_id = $1
		 GROUP BY sli.name, sli.category
		 ORDER BY sli.name, COUNT(*) DESC, MAX(sli.created_at) DESC
		 LIMIT 10`,
		userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get most used items"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var item MemoryItem
		err := rows.Scan(&item.Name, &item.Category, &item.Frequency, &item.LastUsed)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan most used item"})
			return
		}
		stats.MostUsedItems = append(stats.MostUsedItems, item)
	}

	// Get categories with their counts
	rows, err = h.db.Query(context.Background(),
		`SELECT category, COUNT(*) as frequency
		 FROM shopping_list_items sli
		 JOIN shopping_lists sl ON sli.list_id = sl.id
		 WHERE sl.owner_id = $1
		 GROUP BY category
		 ORDER BY frequency DESC`,
		userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get category stats"})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var category string
		var frequency int
		err := rows.Scan(&category, &frequency)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to scan category stat"})
			return
		}
		stats.Categories[category] = frequency
	}

	c.JSON(http.StatusOK, stats)
}