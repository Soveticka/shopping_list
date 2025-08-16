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

	// Check and create list_shares table
	var shareTableExists bool
	err = db.QueryRow(context.Background(),
		"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'list_shares')").Scan(&shareTableExists)
	
	if err != nil {
		return fmt.Errorf("failed to check list_shares table: %w", err)
	}

	if !shareTableExists {
		_, err = db.Exec(context.Background(), `
			CREATE TABLE list_shares (
				id SERIAL PRIMARY KEY,
				list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				permission VARCHAR(20) NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'write', 'admin')),
				status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
				shared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(list_id, user_id)
			);
			
			CREATE INDEX idx_list_shares_list_id ON list_shares(list_id);
			CREATE INDEX idx_list_shares_user_id ON list_shares(user_id);
			CREATE INDEX idx_list_shares_status ON list_shares(status);
		`)
		
		if err != nil {
			return fmt.Errorf("failed to create list_shares table: %w", err)
		}
	}

	return nil
}