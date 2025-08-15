package database

import (
	"context"
	"fmt"
)

func Migrate(db *DB) error {
	// Check if tables exist, if not this will be handled by the schema.sql in docker-compose
	// For now, we'll just ensure the connection works
	var exists bool
	err := db.QueryRow(context.Background(), 
		"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users')").Scan(&exists)
	
	if err != nil {
		return fmt.Errorf("failed to check if tables exist: %w", err)
	}

	if !exists {
		return fmt.Errorf("database tables don't exist - run docker-compose to initialize schema")
	}

	// Verify Authentik columns exist
	var authColumnExists bool
	err = db.QueryRow(context.Background(),
		"SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'authentik_sub')").Scan(&authColumnExists)
	
	if err != nil {
		return fmt.Errorf("failed to check Authentik columns: %w", err)
	}

	if !authColumnExists {
		return fmt.Errorf("Authentik columns missing - ensure migration has been applied")
	}

	return nil
}