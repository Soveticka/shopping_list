package handlers

import (
	"context"
	"net/http"
	"shopping-list/internal/auth"
	"shopping-list/internal/config"
	"shopping-list/internal/database"
	"shopping-list/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

type AuthHandler struct {
	db         *database.DB
	jwtManager *auth.JWTManager
	validator  *validator.Validate
	config     *config.Config
}

func NewAuthHandler(db *database.DB, jwtManager *auth.JWTManager, cfg *config.Config) *AuthHandler {
	return &AuthHandler{
		db:         db,
		jwtManager: jwtManager,
		validator:  validator.New(),
		config:     cfg,
	}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req models.CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if user already exists
	var exists bool
	err := h.db.QueryRow(context.Background(),
		"SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 OR email = $2)",
		req.Username, req.Email).Scan(&exists)
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	if exists {
		c.JSON(http.StatusConflict, gin.H{"error": "User already exists"})
		return
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	// Create user
	var user models.User
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO users (username, email, password_hash, auth_provider) 
		 VALUES ($1, $2, $3, 'local') 
		 RETURNING id, username, email, auth_provider, created_at, updated_at`,
		req.Username, req.Email, hashedPassword).Scan(
		&user.ID, &user.Username, &user.Email, &user.AuthProvider, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Generate JWT token
	token, err := h.jwtManager.GenerateToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusCreated, models.LoginResponse{
		Token: token,
		User:  user,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := h.validator.Struct(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find user by email or username
	var user models.User
	err := h.db.QueryRow(context.Background(),
		`SELECT id, username, email, password_hash, auth_provider, created_at, updated_at 
		 FROM users 
		 WHERE (email = $1 OR username = $1) AND password_hash IS NOT NULL`,
		req.EmailOrUsername).Scan(
		&user.ID, &user.Username, &user.Email, &user.PasswordHash, 
		&user.AuthProvider, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Check password
	if user.PasswordHash == nil || !auth.CheckPasswordHash(req.Password, *user.PasswordHash) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Generate JWT token
	token, err := h.jwtManager.GenerateToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	// Clear password hash from response
	user.PasswordHash = nil

	c.JSON(http.StatusOK, models.LoginResponse{
		Token: token,
		User:  user,
	})
}

// OIDC handlers - placeholder for now
func (h *AuthHandler) OIDCLogin(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "OIDC not implemented yet"})
}

func (h *AuthHandler) OIDCCallback(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "OIDC not implemented yet"})
}

func (h *AuthHandler) LinkOIDC(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "OIDC linking not implemented yet"})
}

func (h *AuthHandler) UnlinkOIDC(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "OIDC unlinking not implemented yet"})
}

func (h *AuthHandler) OIDCStatus(c *gin.Context) {
	userID, exists := auth.GetUserID(c)
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var user models.User
	err := h.db.QueryRow(context.Background(),
		"SELECT authentik_sub, auth_provider, linked_at FROM users WHERE id = $1",
		userID).Scan(&user.AuthentikSub, &user.AuthProvider, &user.LinkedAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"linked":       user.AuthentikSub != nil,
		"auth_provider": user.AuthProvider,
		"linked_at":    user.LinkedAt,
	})
}