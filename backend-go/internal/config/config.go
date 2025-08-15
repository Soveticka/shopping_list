package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Environment string
	Port        string
	Database    DatabaseConfig
	JWT         JWTConfig
	OIDC        OIDCConfig
	CORS        CORSConfig
}

type DatabaseConfig struct {
	Host     string
	Port     string
	Name     string
	User     string
	Password string
}

type JWTConfig struct {
	Secret    string
	ExpiresIn string
}

type OIDCConfig struct {
	ClientID     string
	ClientSecret string
	DiscoveryURL string
	RedirectURI  string
}

type CORSConfig struct {
	AllowedOrigins []string
}

func Load() *Config {
	// Load .env file if it exists
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	return &Config{
		Environment: getEnv("NODE_ENV", "development"),
		Port:        getEnv("PORT", "3001"),
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "postgres"),
			Port:     getEnv("DB_PORT", "5432"),
			Name:     getEnv("DB_NAME", "shopping_list"),
			User:     getEnv("DB_USER", "shopping_user"),
			Password: getEnv("DB_PASSWORD", "shopping_password"),
		},
		JWT: JWTConfig{
			Secret:    getEnv("JWT_SECRET", "your-super-secret-jwt-key-change-this-in-production"),
			ExpiresIn: getEnv("JWT_EXPIRES_IN", "7d"),
		},
		OIDC: OIDCConfig{
			ClientID:     getEnv("OIDC_CLIENT_ID", ""),
			ClientSecret: getEnv("OIDC_CLIENT_SECRET", ""),
			DiscoveryURL: getEnv("OIDC_DISCOVERY_URL", "https://auth.mkomanek.eu/application/o/shopping-list/.well-known/openid_configuration"),
			RedirectURI:  getEnv("OIDC_REDIRECT_URI", "http://localhost:3000/auth/oidc/callback"),
		},
		CORS: CORSConfig{
			AllowedOrigins: []string{
				getEnv("FRONTEND_URL", "http://localhost:3000"),
				"http://localhost:3000",
				"http://192.168.1.27:3000",
			},
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}