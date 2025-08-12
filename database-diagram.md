# Database Schema Diagram

This is a visual representation of the Shopping List application database schema showing all tables and their relationships.

## Tables Overview

### 🟣 users
- Stores user authentication data
- Primary key: `id`
- Unique constraints: `username`, `email`
- Password stored as bcrypt hash

### 🔵 shopping_lists  
- User-owned shopping lists
- Foreign key: `owner_id` → `users.id`
- Supports sharing functionality (future)

### 🟢 shopping_list_items
- Individual items within shopping lists
- Foreign key: `list_id` → `shopping_lists.id`
- Contains item details: name, quantity, category, priority, notes

### 🟡 grocery_memory
- Autocomplete suggestions based on user history
- Foreign key: `user_id` → `users.id`
- Tracks usage frequency and last used timestamps
- Unique constraint: `(user_id, name)`

### 🔴 list_shares (Future Feature)
- Enables sharing shopping lists between users
- Foreign keys: `list_id` → `shopping_lists.id`, `user_id` → `users.id`
- Permission levels: read, write, admin

## Key Relationships

- **One-to-Many**: Users can own multiple shopping lists
- **One-to-Many**: Shopping lists can contain multiple items
- **One-to-Many**: Users have personal grocery memory for autocomplete
- **Many-to-Many**: Shopping lists can be shared with multiple users (future)

## Database Features

- **CASCADE DELETE**: Automatic cleanup when users are deleted
- **Automatic Timestamps**: `created_at` and `updated_at` managed by triggers
- **Performance Indexes**: Optimized for common query patterns
- **Sample Data**: New users receive example shopping list with 5 items
- **Unique Constraints**: Prevent duplicate users and grocery memory entries

## View the Diagram

The complete database diagram is available in `database-diagram.drawio` which can be opened with:
- [draw.io](https://app.diagrams.net/) (online)
- Draw.io desktop application
- VS Code with Draw.io extension