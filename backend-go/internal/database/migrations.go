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

	// Check and create notifications table
	var notificationTableExists bool
	err = db.QueryRow(context.Background(),
		"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notifications')").Scan(&notificationTableExists)
	
	if err != nil {
		return fmt.Errorf("failed to check notifications table: %w", err)
	}

	if !notificationTableExists {
		_, err = db.Exec(context.Background(), `
			CREATE TABLE notifications (
				id SERIAL PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				type VARCHAR(50) NOT NULL,
				title VARCHAR(255) NOT NULL,
				message TEXT NOT NULL,
				data JSONB,
				is_read BOOLEAN NOT NULL DEFAULT FALSE,
				created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
			);

			CREATE INDEX idx_notifications_user_id ON notifications(user_id);
			CREATE INDEX idx_notifications_user_id_unread ON notifications(user_id, is_read);
			CREATE INDEX idx_notifications_created_at ON notifications(created_at);
			CREATE INDEX idx_notifications_type ON notifications(type);

			CREATE OR REPLACE FUNCTION update_notification_updated_at()
			RETURNS TRIGGER AS $$
			BEGIN
				NEW.updated_at = NOW();
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql;

			CREATE TRIGGER trigger_update_notification_updated_at
				BEFORE UPDATE ON notifications
				FOR EACH ROW
				EXECUTE FUNCTION update_notification_updated_at();
		`)
		
		if err != nil {
			return fmt.Errorf("failed to create notifications table: %w", err)
		}
	}

	return nil
}