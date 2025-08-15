package models

import (
	"time"
)

type User struct {
	ID              int       `json:"id" db:"id"`
	Username        string    `json:"username" db:"username"`
	Email           string    `json:"email" db:"email"`
	PasswordHash    *string   `json:"-" db:"password_hash"`
	DefaultListID   *int      `json:"default_list_id" db:"default_list_id"`
	AuthentikSub    *string   `json:"authentik_sub" db:"authentik_sub"`
	AuthProvider    string    `json:"auth_provider" db:"auth_provider"`
	LinkedAt        *time.Time `json:"linked_at" db:"linked_at"`
	LastOIDCLogin   *time.Time `json:"last_oidc_login" db:"last_oidc_login"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

type CreateUserRequest struct {
	Username string `json:"username" validate:"required,min=3,max=50"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=6"`
}

type LoginRequest struct {
	EmailOrUsername string `json:"email_or_username" validate:"required"`
	Password        string `json:"password" validate:"required"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type AuthAudit struct {
	ID           int       `json:"id" db:"id"`
	UserID       *int      `json:"user_id" db:"user_id"`
	AuthMethod   string    `json:"auth_method" db:"auth_method"`
	EventType    string    `json:"event_type" db:"event_type"`
	IPAddress    *string   `json:"ip_address" db:"ip_address"`
	UserAgent    *string   `json:"user_agent" db:"user_agent"`
	Success      bool      `json:"success" db:"success"`
	ErrorMessage *string   `json:"error_message" db:"error_message"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}