package models

import "time"

type ShoppingList struct {
	ID         int       `json:"id" db:"id"`
	Name       string    `json:"name" db:"name"`
	OwnerID    int       `json:"owner_id" db:"owner_id"`
	IsShared   bool      `json:"is_shared" db:"is_shared"`
	ShareToken *string   `json:"share_token,omitempty" db:"share_token"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
	
	// Computed fields
	ItemCount      int    `json:"item_count,omitempty"`
	CompletedCount int    `json:"completed_count,omitempty"`
	Permission     string `json:"permission,omitempty"` // read, write, admin
	IsOwner        bool   `json:"is_owner,omitempty"`
}

type ShoppingListItem struct {
	ID        int       `json:"id" db:"id"`
	ListID    int       `json:"list_id" db:"list_id"`
	Name      string    `json:"name" db:"name"`
	Quantity  int       `json:"quantity" db:"quantity"`
	Category  string    `json:"category" db:"category"`
	Priority  string    `json:"priority" db:"priority"`
	Notes     *string   `json:"notes" db:"notes"`
	Completed bool      `json:"completed" db:"completed"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type ListShare struct {
	ID         int       `json:"id" db:"id"`
	ListID     int       `json:"list_id" db:"list_id"`
	UserID     int       `json:"user_id" db:"user_id"`
	Permission string    `json:"permission" db:"permission"`
	Status     string    `json:"status" db:"status"`
	SharedAt   time.Time `json:"shared_at" db:"shared_at"`
	
	// Joined fields
	Username string `json:"username,omitempty"`
	Email    string `json:"email,omitempty"`
	ListName string `json:"list_name,omitempty"`
}

type CreateListRequest struct {
	Name string `json:"name" validate:"required,min=1,max=255"`
}

type UpdateListRequest struct {
	Name string `json:"name" validate:"required,min=1,max=255"`
}

type CreateItemRequest struct {
	Name     string  `json:"name" validate:"required,min=1,max=255"`
	Quantity int     `json:"quantity" validate:"min=1"`
	Category string  `json:"category" validate:"required"`
	Priority string  `json:"priority" validate:"required,oneof=low medium high"`
	Notes    *string `json:"notes"`
}

type UpdateItemRequest struct {
	Name      *string `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	Quantity  *int    `json:"quantity,omitempty" validate:"omitempty,min=1"`
	Category  *string `json:"category,omitempty"`
	Priority  *string `json:"priority,omitempty" validate:"omitempty,oneof=low medium high"`
	Notes     *string `json:"notes,omitempty"`
	Completed *bool   `json:"completed,omitempty"`
}

type ShareListRequest struct {
	Email      string `json:"email" validate:"required,email"`
	Permission string `json:"permission" validate:"required,oneof=read write admin"`
}