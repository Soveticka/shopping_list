package models

import (
	"encoding/json"
	"time"
)

type Notification struct {
	ID        int             `json:"id" db:"id"`
	UserID    int             `json:"user_id" db:"user_id"`
	Type      string          `json:"type" db:"type"`
	Title     string          `json:"title" db:"title"`
	Message   string          `json:"message" db:"message"`
	Data      json.RawMessage `json:"data,omitempty" db:"data"`
	IsRead    bool            `json:"is_read" db:"is_read"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
}

type NotificationData struct {
	ListID         *int    `json:"list_id,omitempty"`
	InviterUserID  *int    `json:"inviter_user_id,omitempty"`
	InviterName    *string `json:"inviter_name,omitempty"`
	ListName       *string `json:"list_name,omitempty"`
	Permission     *string `json:"permission,omitempty"`
	ShareID        *int    `json:"share_id,omitempty"`
}

type GroceryMemory struct {
	ID         int       `json:"id" db:"id"`
	UserID     int       `json:"user_id" db:"user_id"`
	Name       string    `json:"name" db:"name"`
	Category   string    `json:"category" db:"category"`
	Priority   string    `json:"priority" db:"priority"`
	UsageCount int       `json:"usage_count" db:"usage_count"`
	LastUsed   time.Time `json:"last_used" db:"last_used"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
}