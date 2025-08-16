package api

import (
	"shopping-list/internal/auth"
	"shopping-list/internal/config"
	"shopping-list/internal/database"
	"shopping-list/internal/handlers"

	"github.com/gin-gonic/gin"
)

func SetupRouter(db *database.DB, cfg *config.Config) *gin.Engine {
	router := gin.Default()

	// Custom CORS middleware
	router.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		
		// Check if origin is allowed
		allowed := false
		for _, allowedOrigin := range cfg.CORS.AllowedOrigins {
			if origin == allowedOrigin {
				allowed = true
				break
			}
		}
		
		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Length, Content-Type, Authorization")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		
		c.Next()
	})

	// Initialize JWT manager
	jwtManager := auth.NewJWTManager(cfg.JWT)

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(db, jwtManager, cfg)
	userHandler := handlers.NewUserHandler(db)
	listHandler := handlers.NewListHandler(db)
	itemHandler := handlers.NewItemHandler(db)
	sharingHandler := handlers.NewSharingHandler(db)
	memoryHandler := handlers.NewMemoryHandler(db)

	// Public routes
	api := router.Group("/api")
	{
		// Auth routes
		auth := api.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			
			// OIDC routes
			oidc := auth.Group("/oidc")
			{
				oidc.POST("/login", authHandler.OIDCLogin)
				oidc.POST("/callback", authHandler.OIDCCallback)
			}
		}
	}

	// Protected routes
	protected := api.Group("")
	protected.Use(auth.JWTMiddleware(jwtManager))
	{
		// User routes
		users := protected.Group("/users")
		{
			users.GET("/me", userHandler.GetCurrentUser)
			users.PUT("/me", userHandler.UpdateCurrentUser)
			users.DELETE("/me", userHandler.DeleteCurrentUser)
		}

		// OIDC protected routes
		oidc := protected.Group("/auth/oidc")
		{
			oidc.POST("/link", authHandler.LinkOIDC)
			oidc.DELETE("/unlink", authHandler.UnlinkOIDC)
			oidc.GET("/status", authHandler.OIDCStatus)
		}

		// Shopping list routes
		lists := protected.Group("/lists")
		{
			lists.GET("", listHandler.GetLists)
			lists.POST("", listHandler.CreateList)
			lists.GET("/:id", listHandler.GetList)
			lists.PUT("/:id", listHandler.UpdateList)
			lists.DELETE("/:id", listHandler.DeleteList)
			lists.POST("/:id/default", listHandler.SetDefaultList)

			// List sharing
			lists.POST("/:id/share", sharingHandler.ShareList)
			lists.GET("/:id/shares", sharingHandler.GetListShares)
			lists.DELETE("/:id/shares/:shareId", sharingHandler.RemoveShare)
			lists.POST("/:id/generate-token", sharingHandler.GenerateShareToken)
		}

		// Sharing routes
		sharing := protected.Group("/sharing")
		{
			sharing.POST("/join", sharingHandler.JoinByToken)
			sharing.GET("/lists", sharingHandler.GetSharedLists)
		}

		// Item routes - using consistent :id parameter
		items := protected.Group("/lists/:id/items")
		{
			items.GET("", itemHandler.GetItems)
			items.POST("", itemHandler.CreateItem)
			items.GET("/:itemId", itemHandler.GetItem)
			items.PUT("/:itemId", itemHandler.UpdateItem)
			items.DELETE("/:itemId", itemHandler.DeleteItem)
			items.POST("/bulk-update", itemHandler.BulkUpdateItems)
		}

		// Memory/autocomplete routes
		memory := protected.Group("/memory")
		{
			memory.GET("/items", memoryHandler.GetMemory)
			memory.GET("/categories", memoryHandler.GetCategories)
			memory.GET("/stats", memoryHandler.GetMemoryStats)
		}

		// Notification routes
		notifications := protected.Group("/notifications")
		{
			notifications.GET("", userHandler.GetNotifications)
			notifications.POST("/:id/read", userHandler.MarkNotificationRead)
			notifications.POST("/read-all", userHandler.MarkAllNotificationsRead)
		}
	}

	return router
}