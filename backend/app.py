#!/usr/bin/env python3
"""
Shopping List Backend API
Developed with Claude AI using Claude Code
"""

import os
import secrets
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
import psycopg2
from psycopg2.extras import RealDictCursor
import bcrypt
from dotenv import load_dotenv
from marshmallow import Schema, fields, ValidationError
from oidc_client import create_oidc_client
from user_sync import sync_user_with_oidc, UserSyncManager

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Configuration
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET', 'your-super-secret-jwt-key-change-this-in-production')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)

# Initialize extensions
jwt = JWTManager(app)
CORS(app, origins=[
    os.getenv('FRONTEND_URL', 'http://localhost:3000'),
    'http://localhost:3000',
    'http://192.168.1.27:3000'
])

# Database configuration
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'postgres'),
    'port': int(os.getenv('DB_PORT', 5432)),
    'database': os.getenv('DB_NAME', 'shopping_list'),
    'user': os.getenv('DB_USER', 'shopping_user'),
    'password': os.getenv('DB_PASSWORD', 'shopping_password')
}

def get_db_connection():
    """Get database connection"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except psycopg2.Error as e:
        print(f"Database connection error: {e}")
        raise

# Validation schemas
class UserRegistrationSchema(Schema):
    username = fields.Str(required=True, validate=lambda x: 3 <= len(x) <= 30)
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=lambda x: len(x) >= 6)

class UserLoginSchema(Schema):
    login = fields.Str(required=True)  # Can be email or username
    password = fields.Str(required=True)

class ShoppingListItemSchema(Schema):
    name = fields.Str(required=True, validate=lambda x: 1 <= len(x) <= 255)
    quantity = fields.Int(missing=1, validate=lambda x: x >= 1)
    category = fields.Str(required=True, validate=lambda x: x in [
        'produce', 'dairy', 'meat', 'pantry', 'frozen', 
        'bakery', 'beverages', 'snacks', 'household', 'health'
    ])
    priority = fields.Str(missing='low', validate=lambda x: x in ['low', 'medium', 'high'])
    notes = fields.Str(missing='')
    completed = fields.Bool(missing=False)

class ShoppingListSchema(Schema):
    name = fields.Str(missing='My Shopping List', validate=lambda x: 1 <= len(x) <= 255)

# Error handlers
@app.errorhandler(ValidationError)
def handle_validation_error(e):
    return jsonify({'error': 'Validation error', 'details': e.messages}), 400

@app.errorhandler(psycopg2.Error)
def handle_db_error(e):
    return jsonify({'error': 'Database error'}), 500

@app.errorhandler(404)
def handle_not_found(e):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def handle_internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

# Health check
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'version': '1.0.0'
    })

# Authentication routes
@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        schema = UserRegistrationSchema()
        data = schema.load(request.json)
        
        username = data['username']
        email = data['email']
        password = data['password']
        
        # Hash password
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check if user exists
                cur.execute("SELECT id FROM users WHERE email = %s OR username = %s", (email, username))
                if cur.fetchone():
                    return jsonify({'error': 'User already exists with this email or username'}), 409
                
                # Create user
                cur.execute(
                    "INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s) RETURNING id, username, email, created_at",
                    (username, email, password_hash)
                )
                user = cur.fetchone()
                
                # Create default shopping list
                cur.execute(
                    "INSERT INTO shopping_lists (name, owner_id) VALUES (%s, %s) RETURNING id",
                    ('My Shopping List', user['id'])
                )
                list_result = cur.fetchone()
                list_id = list_result['id']
                
                # Add sample items to the list
                sample_items = [
                    ('Milk', 1, 'dairy', 'medium', 'Organic preferred'),
                    ('Bananas', 6, 'produce', 'low', 'Not too ripe'),
                    ('Chicken Breast', 2, 'meat', 'high', '1 lb package'),
                    ('Bread', 1, 'bakery', 'medium', 'Whole wheat'),
                    ('Greek Yogurt', 2, 'dairy', 'low', 'Vanilla flavor')
                ]
                
                for item_name, quantity, category, priority, notes in sample_items:
                    # Add to shopping list
                    cur.execute("""
                        INSERT INTO shopping_list_items (list_id, name, quantity, category, priority, notes)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (list_id, item_name, quantity, category, priority, notes))
                    
                    # Add to grocery memory
                    cur.execute("""
                        INSERT INTO grocery_memory (user_id, name, category, priority, usage_count, last_used)
                        VALUES (%s, %s, %s, %s, 1, CURRENT_TIMESTAMP)
                        ON CONFLICT (user_id, name) 
                        DO UPDATE SET 
                            category = EXCLUDED.category,
                            priority = EXCLUDED.priority,
                            usage_count = grocery_memory.usage_count + 1,
                            last_used = CURRENT_TIMESTAMP
                    """, (user['id'], item_name, category, priority))
                
                
                conn.commit()
                
                # Create access token
                access_token = create_access_token(identity=str(user['id']))
                
                return jsonify({
                    'message': 'User registered successfully',
                    'user': {
                        'id': user['id'],
                        'username': user['username'],
                        'email': user['email'],
                        'created_at': user['created_at'].isoformat()
                    },
                    'token': access_token
                }), 201
                
    except ValidationError as e:
        return jsonify({'error': 'Validation error', 'details': e.messages}), 400
    except Exception as e:
        print(f"Registration error: {e}")
        return jsonify({'error': 'Failed to register user'}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        schema = UserLoginSchema()
        data = schema.load(request.json)
        
        login = data['login']
        password = data['password']
        
        # Determine if login is email or username
        is_email = '@' in login
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if is_email:
                    cur.execute(
                        "SELECT id, username, email, password_hash FROM users WHERE email = %s",
                        (login,)
                    )
                else:
                    cur.execute(
                        "SELECT id, username, email, password_hash FROM users WHERE username = %s",
                        (login,)
                    )
                
                user = cur.fetchone()
                
                if not user or not bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
                    return jsonify({'error': 'Invalid login or password'}), 401
                
                # Create access token
                access_token = create_access_token(identity=str(user['id']))
                
                return jsonify({
                    'message': 'Login successful',
                    'user': {
                        'id': user['id'],
                        'username': user['username'],
                        'email': user['email']
                    },
                    'token': access_token
                })
                
    except ValidationError as e:
        return jsonify({'error': 'Validation error', 'details': e.messages}), 400
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({'error': 'Failed to login'}), 500

@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def get_current_user():
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, username, email, created_at FROM users WHERE id = %s",
                    (user_id,)
                )
                user = cur.fetchone()
                
                if not user:
                    return jsonify({'error': 'User not found'}), 404
                
                return jsonify({
                    'user': {
                        'id': user['id'],
                        'username': user['username'],
                        'email': user['email'],
                        'created_at': user['created_at'].isoformat()
                    }
                })
                
    except Exception as e:
        print(f"Get user error: {e}")
        return jsonify({'error': 'Failed to get user info'}), 500

# Grocery memory routes
@app.route('/api/groceries/memory', methods=['GET'])
@jwt_required()
def get_grocery_memory():
    try:
        user_id = int(get_jwt_identity())
        search = request.args.get('search', '')
        limit = int(request.args.get('limit', 10))
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if search:
                    cur.execute("""
                        SELECT name, category, priority, usage_count, last_used
                        FROM grocery_memory 
                        WHERE user_id = %s AND LOWER(name) LIKE LOWER(%s)
                        ORDER BY usage_count DESC, last_used DESC 
                        LIMIT %s
                    """, (user_id, f'%{search}%', limit))
                else:
                    cur.execute("""
                        SELECT name, category, priority, usage_count, last_used
                        FROM grocery_memory 
                        WHERE user_id = %s
                        ORDER BY usage_count DESC, last_used DESC 
                        LIMIT %s
                    """, (user_id, limit))
                
                groceries = cur.fetchall()
                
                return jsonify({
                    'groceries': [dict(row) for row in groceries]
                })
                
    except Exception as e:
        print(f"Get grocery memory error: {e}")
        return jsonify({'error': 'Failed to get grocery memory'}), 500

@app.route('/api/groceries/frequent', methods=['GET'])
@jwt_required()
def get_frequent_groceries():
    try:
        user_id = int(get_jwt_identity())
        limit = int(request.args.get('limit', 8))
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT name, category, priority, usage_count, last_used
                    FROM grocery_memory 
                    WHERE user_id = %s
                    ORDER BY usage_count DESC, last_used DESC 
                    LIMIT %s
                """, (user_id, limit))
                
                groceries = cur.fetchall()
                
                return jsonify({
                    'groceries': [dict(row) for row in groceries]
                })
                
    except Exception as e:
        print(f"Get frequent groceries error: {e}")
        return jsonify({'error': 'Failed to get frequent groceries'}), 500

@app.route('/api/groceries/stats', methods=['GET'])
@jwt_required()
def get_grocery_stats():
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        COUNT(*) as total_items,
                        COALESCE(SUM(usage_count), 0) as total_usage,
                        COALESCE(AVG(usage_count), 0) as avg_usage
                    FROM grocery_memory 
                    WHERE user_id = %s
                """, (user_id,))
                
                stats = cur.fetchone()
                
                return jsonify({
                    'stats': {
                        'totalItems': stats['total_items'],
                        'totalUsage': stats['total_usage'],
                        'averageUsage': round(float(stats['avg_usage']), 1)
                    }
                })
                
    except Exception as e:
        print(f"Get grocery stats error: {e}")
        return jsonify({'error': 'Failed to get grocery statistics'}), 500

# Shopping list routes
@app.route('/api/lists', methods=['GET'])
@jwt_required()
def get_shopping_lists():
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get owned lists
                cur.execute("""
                    SELECT 
                        sl.id, sl.name, sl.is_shared, sl.created_at, sl.updated_at,
                        COUNT(sli.id) as item_count,
                        COUNT(CASE WHEN sli.completed = true THEN 1 END) as completed_count,
                        COALESCE((sl.id = u.default_list_id), false) as is_default,
                        'owner' as role,
                        u.username as owner_username
                    FROM shopping_lists sl
                    LEFT JOIN shopping_list_items sli ON sl.id = sli.list_id
                    LEFT JOIN users u ON u.id = sl.owner_id
                    WHERE sl.owner_id = %s
                    GROUP BY sl.id, u.default_list_id, u.username
                    
                    UNION
                    
                    SELECT 
                        sl.id, sl.name, sl.is_shared, sl.created_at, sl.updated_at,
                        COUNT(sli.id) as item_count,
                        COUNT(CASE WHEN sli.completed = true THEN 1 END) as completed_count,
                        false as is_default,
                        ls.permission as role,
                        u.username as owner_username
                    FROM shopping_lists sl
                    LEFT JOIN shopping_list_items sli ON sl.id = sli.list_id
                    LEFT JOIN users u ON u.id = sl.owner_id
                    INNER JOIN list_shares ls ON ls.list_id = sl.id
                    WHERE ls.user_id = %s AND ls.status = 'accepted'
                    GROUP BY sl.id, ls.permission, u.username
                    
                    ORDER BY updated_at DESC
                """, (user_id, user_id))
                
                lists = cur.fetchall()
                
                return jsonify({
                    'lists': [dict(row) for row in lists]
                })
                
    except Exception as e:
        print(f"Get shopping lists error: {e}")
        return jsonify({'error': 'Failed to get shopping lists'}), 500

@app.route('/api/lists', methods=['POST'])
@jwt_required()
def create_shopping_list():
    try:
        user_id = int(get_jwt_identity())
        schema = ShoppingListSchema()
        data = schema.load(request.json or {})
        
        name = data['name']
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO shopping_lists (name, owner_id)
                    VALUES (%s, %s)
                    RETURNING id, name, is_shared, created_at, updated_at
                """, (name, user_id))
                
                list_data = cur.fetchone()
                conn.commit()
                
                return jsonify({
                    'message': 'Shopping list created',
                    'list': dict(list_data)
                }), 201
                
    except ValidationError as e:
        return jsonify({'error': 'Validation error', 'details': e.messages}), 400
    except Exception as e:
        print(f"Create shopping list error: {e}")
        return jsonify({'error': 'Failed to create shopping list'}), 500

@app.route('/api/lists/<int:list_id>', methods=['GET'])
@jwt_required()
def get_shopping_list(list_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get list info and user's permission (check both owned and shared lists)
                cur.execute("""
                    SELECT sl.id, sl.name, sl.is_shared, sl.created_at, sl.updated_at, 
                           CASE 
                               WHEN sl.owner_id = %s THEN 'admin'
                               ELSE ls.permission
                           END as user_permission,
                           CASE WHEN sl.owner_id = %s THEN TRUE ELSE FALSE END as is_owner
                    FROM shopping_lists sl
                    LEFT JOIN list_shares ls ON ls.list_id = sl.id AND ls.user_id = %s AND ls.status = 'accepted'
                    WHERE sl.id = %s AND (sl.owner_id = %s OR ls.id IS NOT NULL)
                """, (user_id, user_id, user_id, list_id, user_id))
                
                list_data = cur.fetchone()
                if not list_data:
                    return jsonify({'error': 'Shopping list not found or access denied'}), 404
                
                # Get list items
                cur.execute("""
                    SELECT id, name, quantity, category, priority, notes, completed, created_at, updated_at
                    FROM shopping_list_items
                    WHERE list_id = %s
                    ORDER BY created_at DESC
                """, (list_id,))
                
                items = cur.fetchall()
                
                return jsonify({
                    'list': {
                        **dict(list_data),
                        'items': [dict(item) for item in items]
                    }
                })
                
    except Exception as e:
        print(f"Get shopping list error: {e}")
        return jsonify({'error': 'Failed to get shopping list'}), 500

@app.route('/api/lists/<int:list_id>/items', methods=['POST'])
@jwt_required()
def add_list_item(list_id):
    try:
        user_id = int(get_jwt_identity())
        schema = ShoppingListItemSchema()
        data = schema.load(request.json)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify list access (owner or shared with write permission)
                cur.execute("""
                    SELECT sl.id 
                    FROM shopping_lists sl
                    LEFT JOIN list_shares ls ON ls.list_id = sl.id AND ls.user_id = %s AND ls.status = 'accepted'
                    WHERE sl.id = %s AND (
                        sl.owner_id = %s OR 
                        (ls.id IS NOT NULL AND ls.permission IN ('write', 'admin'))
                    )
                """, (user_id, list_id, user_id))
                if not cur.fetchone():
                    return jsonify({'error': 'Shopping list not found or access denied'}), 404
                
                # Add item
                cur.execute("""
                    INSERT INTO shopping_list_items (list_id, name, quantity, category, priority, notes)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id, name, quantity, category, priority, notes, completed, created_at, updated_at
                """, (list_id, data['name'], data['quantity'], data['category'], data['priority'], data['notes']))
                
                item = cur.fetchone()
                
                # Update grocery memory
                cur.execute("""
                    INSERT INTO grocery_memory (user_id, name, category, priority, usage_count, last_used)
                    VALUES (%s, %s, %s, %s, 1, CURRENT_TIMESTAMP)
                    ON CONFLICT (user_id, name) 
                    DO UPDATE SET 
                        category = EXCLUDED.category,
                        priority = EXCLUDED.priority,
                        usage_count = grocery_memory.usage_count + 1,
                        last_used = CURRENT_TIMESTAMP
                """, (user_id, data['name'], data['category'], data['priority']))
                
                conn.commit()
                
                return jsonify({
                    'message': 'Item added to shopping list',
                    'item': dict(item)
                }), 201
                
    except ValidationError as e:
        return jsonify({'error': 'Validation error', 'details': e.messages}), 400
    except Exception as e:
        print(f"Add item error: {e}")
        return jsonify({'error': 'Failed to add item to shopping list'}), 500

@app.route('/api/lists/<int:list_id>/items/<int:item_id>', methods=['PUT'])
@jwt_required()
def update_list_item(list_id, item_id):
    try:
        user_id = int(get_jwt_identity())
        schema = ShoppingListItemSchema()
        data = schema.load(request.json)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify list access (owner or shared with write permission)
                cur.execute("""
                    SELECT sl.id 
                    FROM shopping_lists sl
                    LEFT JOIN list_shares ls ON ls.list_id = sl.id AND ls.user_id = %s AND ls.status = 'accepted'
                    WHERE sl.id = %s AND (
                        sl.owner_id = %s OR 
                        (ls.id IS NOT NULL AND ls.permission IN ('write', 'admin'))
                    )
                """, (user_id, list_id, user_id))
                if not cur.fetchone():
                    return jsonify({'error': 'Shopping list not found or access denied'}), 404
                
                # Update the item
                cur.execute("""
                    UPDATE shopping_list_items 
                    SET name = %s, quantity = %s, category = %s, priority = %s, notes = %s, completed = %s
                    WHERE id = %s AND list_id = %s
                    RETURNING id, name, quantity, category, priority, notes, completed, created_at, updated_at
                """, (data['name'], data['quantity'], data['category'], data['priority'], data['notes'], data['completed'], item_id, list_id))
                
                item = cur.fetchone()
                if not item:
                    return jsonify({'error': 'Item not found'}), 404
                
                conn.commit()
                
                return jsonify({
                    'message': 'Item updated successfully',
                    'item': dict(item)
                }), 200
                
    except ValidationError as e:
        return jsonify({'error': 'Validation error', 'details': e.messages}), 400
    except Exception as e:
        print(f"Update item error: {e}")
        return jsonify({'error': 'Failed to update item'}), 500

@app.route('/api/lists/<int:list_id>/items/<int:item_id>/toggle', methods=['PUT'])
@jwt_required()
def toggle_list_item(list_id, item_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify list access (owner or shared with write permission for toggling)
                # Note: Even read-only users should be able to toggle items (like in shared view)
                cur.execute("""
                    SELECT sl.id 
                    FROM shopping_lists sl
                    LEFT JOIN list_shares ls ON ls.list_id = sl.id AND ls.user_id = %s AND ls.status = 'accepted'
                    WHERE sl.id = %s AND (
                        sl.owner_id = %s OR 
                        ls.id IS NOT NULL
                    )
                """, (user_id, list_id, user_id))
                if not cur.fetchone():
                    return jsonify({'error': 'Shopping list not found or access denied'}), 404
                
                # Toggle the item's completed status
                cur.execute("""
                    UPDATE shopping_list_items 
                    SET completed = NOT completed, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s AND list_id = %s
                    RETURNING id, name, completed
                """, (item_id, list_id))
                
                item = cur.fetchone()
                if not item:
                    return jsonify({'error': 'Item not found'}), 404
                
                conn.commit()
                
                return jsonify({
                    'message': 'Item toggled successfully',
                    'item': {
                        'id': item['id'],
                        'name': item['name'],
                        'completed': item['completed']
                    }
                }), 200
                
    except Exception as e:
        print(f"Toggle item error: {e}")
        return jsonify({'error': 'Failed to toggle item'}), 500

@app.route('/api/lists/<int:list_id>/items/<int:item_id>', methods=['DELETE'])
@jwt_required()
def delete_list_item(list_id, item_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify list access (owner or shared with write permission)
                cur.execute("""
                    SELECT sl.id 
                    FROM shopping_lists sl
                    LEFT JOIN list_shares ls ON ls.list_id = sl.id AND ls.user_id = %s AND ls.status = 'accepted'
                    WHERE sl.id = %s AND (
                        sl.owner_id = %s OR 
                        (ls.id IS NOT NULL AND ls.permission IN ('write', 'admin'))
                    )
                """, (user_id, list_id, user_id))
                if not cur.fetchone():
                    return jsonify({'error': 'Shopping list not found or access denied'}), 404
                
                # Delete the item
                cur.execute("""
                    DELETE FROM shopping_list_items 
                    WHERE id = %s AND list_id = %s
                    RETURNING id, name
                """, (item_id, list_id))
                
                item = cur.fetchone()
                if not item:
                    return jsonify({'error': 'Item not found'}), 404
                
                conn.commit()
                
                return jsonify({
                    'message': 'Item deleted successfully',
                    'item': {
                        'id': item['id'],
                        'name': item['name']
                    }
                }), 200
                
    except Exception as e:
        print(f"Delete item error: {e}")
        return jsonify({'error': 'Failed to delete item'}), 500

@app.route('/api/lists/<int:list_id>', methods=['PUT'])
@jwt_required()
def update_shopping_list(list_id):
    try:
        user_id = int(get_jwt_identity())
        schema = ShoppingListSchema()
        data = schema.load(request.json)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Update list name
                cur.execute("""
                    UPDATE shopping_lists 
                    SET name = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s AND owner_id = %s
                    RETURNING id, name, is_shared, created_at, updated_at
                """, (data['name'], list_id, user_id))
                
                list_data = cur.fetchone()
                if not list_data:
                    return jsonify({'error': 'Shopping list not found'}), 404
                
                conn.commit()
                
                return jsonify({
                    'message': 'Shopping list updated',
                    'list': dict(list_data)
                }), 200
                
    except ValidationError as e:
        return jsonify({'error': 'Validation error', 'details': e.messages}), 400
    except Exception as e:
        print(f"Update shopping list error: {e}")
        return jsonify({'error': 'Failed to update shopping list'}), 500

@app.route('/api/lists/<int:list_id>', methods=['DELETE'])
@jwt_required()
def delete_shopping_list(list_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check if user owns the list
                cur.execute(
                    "SELECT id, name FROM shopping_lists WHERE id = %s AND owner_id = %s",
                    (list_id, user_id)
                )
                list_data = cur.fetchone()
                
                if not list_data:
                    return jsonify({'error': 'Shopping list not found'}), 404
                
                # Delete the list (CASCADE will delete items automatically)
                cur.execute(
                    "DELETE FROM shopping_lists WHERE id = %s AND owner_id = %s",
                    (list_id, user_id)
                )
                
                conn.commit()
                
                return jsonify({
                    'message': f'Shopping list "{list_data["name"]}" deleted successfully'
                }), 200
                
    except Exception as e:
        print(f"Delete shopping list error: {e}")
        return jsonify({'error': 'Failed to delete shopping list'}), 500

@app.route('/api/users/default-list', methods=['PUT'])
@jwt_required()
def set_default_list():
    try:
        user_id = int(get_jwt_identity())
        data = request.json
        
        if not data or 'list_id' not in data:
            return jsonify({'error': 'list_id is required'}), 400
        
        list_id = data['list_id']
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify the user owns the list
                if list_id:
                    cur.execute(
                        "SELECT id FROM shopping_lists WHERE id = %s AND owner_id = %s",
                        (list_id, user_id)
                    )
                    if not cur.fetchone():
                        return jsonify({'error': 'Shopping list not found or not owned by user'}), 404
                
                # Update user's default list
                cur.execute(
                    "UPDATE users SET default_list_id = %s WHERE id = %s",
                    (list_id if list_id else None, user_id)
                )
                
                conn.commit()
                
                return jsonify({
                    'message': 'Default shopping list updated successfully',
                    'default_list_id': list_id
                }), 200
                
    except Exception as e:
        print(f"Set default list error: {e}")
        return jsonify({'error': 'Failed to set default shopping list'}), 500

@app.route('/api/users/default-list', methods=['GET'])
@jwt_required()
def get_default_list():
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT default_list_id FROM users WHERE id = %s",
                    (user_id,)
                )
                user = cur.fetchone()
                
                if not user:
                    return jsonify({'error': 'User not found'}), 404
                
                default_list_id = user['default_list_id']
                
                if default_list_id:
                    # Get the default list details
                    cur.execute("""
                        SELECT id, name, is_shared, created_at, updated_at
                        FROM shopping_lists
                        WHERE id = %s AND owner_id = %s
                    """, (default_list_id, user_id))
                    
                    default_list = cur.fetchone()
                    
                    return jsonify({
                        'default_list_id': default_list_id,
                        'default_list': dict(default_list) if default_list else None
                    })
                else:
                    return jsonify({
                        'default_list_id': None,
                        'default_list': None
                    })
                
    except Exception as e:
        print(f"Get default list error: {e}")
        return jsonify({'error': 'Failed to get default shopping list'}), 500

# Shopping list sharing routes
@app.route('/api/lists/<int:list_id>/share', methods=['POST'])
@jwt_required()
def generate_share_link(list_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify user owns the list
                cur.execute(
                    "SELECT id, name FROM shopping_lists WHERE id = %s AND owner_id = %s",
                    (list_id, user_id)
                )
                list_data = cur.fetchone()
                
                if not list_data:
                    return jsonify({'error': 'Shopping list not found or not owned by user'}), 404
                
                # Generate a secure random token
                share_token = secrets.token_urlsafe(32)
                
                # Update the list with the share token
                cur.execute(
                    "UPDATE shopping_lists SET share_token = %s WHERE id = %s",
                    (share_token, list_id)
                )
                
                conn.commit()
                
                # Create frontend URL (default to localhost:3000 for development)
                frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:3000/')
                if not frontend_url.endswith('/'):
                    frontend_url += '/'
                
                return jsonify({
                    'message': 'Share link generated successfully',
                    'share_token': share_token,
                    'share_url': f"{frontend_url}s/{share_token}",
                    'list_name': list_data['name']
                }), 200
                
    except Exception as e:
        print(f"Generate share link error: {e}")
        return jsonify({'error': 'Failed to generate share link'}), 500

@app.route('/api/shared/<string:share_token>', methods=['GET'])
def get_shared_shopping_list(share_token):
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get list info by share token
                cur.execute("""
                    SELECT sl.id, sl.name, sl.created_at, sl.updated_at,
                           u.username as owner_username
                    FROM shopping_lists sl
                    JOIN users u ON sl.owner_id = u.id
                    WHERE sl.share_token = %s
                """, (share_token,))
                
                list_data = cur.fetchone()
                if not list_data:
                    return jsonify({'error': 'Shared shopping list not found'}), 404
                
                # Get list items
                cur.execute("""
                    SELECT id, name, quantity, category, priority, notes, completed, created_at, updated_at
                    FROM shopping_list_items
                    WHERE list_id = %s
                    ORDER BY completed ASC, created_at DESC
                """, (list_data['id'],))
                
                items = cur.fetchall()
                
                return jsonify({
                    'list': {
                        **dict(list_data),
                        'items': [dict(item) for item in items]
                    }
                })
                
    except Exception as e:
        print(f"Get shared shopping list error: {e}")
        return jsonify({'error': 'Failed to get shared shopping list'}), 500

@app.route('/api/shared/<string:share_token>/items/<int:item_id>/toggle', methods=['PUT'])
def toggle_shared_item(share_token, item_id):
    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify the share token is valid and get list_id
                cur.execute(
                    "SELECT id FROM shopping_lists WHERE share_token = %s",
                    (share_token,)
                )
                list_data = cur.fetchone()
                
                if not list_data:
                    return jsonify({'error': 'Invalid share token'}), 404
                
                # Toggle the item's completed status
                cur.execute("""
                    UPDATE shopping_list_items 
                    SET completed = NOT completed, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s AND list_id = %s
                    RETURNING id, completed
                """, (item_id, list_data['id']))
                
                item = cur.fetchone()
                if not item:
                    return jsonify({'error': 'Item not found'}), 404
                
                conn.commit()
                
                return jsonify({
                    'message': 'Item status updated',
                    'item': {
                        'id': item['id'],
                        'completed': item['completed']
                    }
                }), 200
                
    except Exception as e:
        print(f"Toggle shared item error: {e}")
        return jsonify({'error': 'Failed to update item'}), 500

# User search and notifications routes
@app.route('/api/users/search', methods=['GET'])
@jwt_required()
def search_users():
    try:
        query = request.args.get('q', '').strip()
        if not query or len(query) < 2:
            return jsonify({'users': []}), 200
        
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, username, email
                    FROM users 
                    WHERE id != %s 
                    AND (LOWER(username) LIKE LOWER(%s) OR LOWER(email) LIKE LOWER(%s))
                    ORDER BY username
                    LIMIT 10
                """, (user_id, f'%{query}%', f'%{query}%'))
                
                users = cur.fetchall()
                
                return jsonify({
                    'users': [dict(user) for user in users]
                })
                
    except Exception as e:
        print(f"Search users error: {e}")
        return jsonify({'error': 'Failed to search users'}), 500

@app.route('/api/lists/<int:list_id>/invite', methods=['POST'])
@jwt_required()
def invite_user_to_list(list_id):
    try:
        user_id = int(get_jwt_identity())
        data = request.json
        
        if not data or 'username' not in data:
            return jsonify({'error': 'Username is required'}), 400
        
        username = data['username'].strip()
        permission = data.get('permission', 'read')  # 'read' or 'write'
        
        if permission not in ['read', 'write']:
            return jsonify({'error': 'Invalid permission level'}), 400
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Verify list ownership
                cur.execute(
                    "SELECT id, name FROM shopping_lists WHERE id = %s AND owner_id = %s",
                    (list_id, user_id)
                )
                list_data = cur.fetchone()
                
                if not list_data:
                    return jsonify({'error': 'Shopping list not found or not owned by user'}), 404
                
                # Find the user to invite
                cur.execute(
                    "SELECT id, username, email FROM users WHERE username = %s",
                    (username,)
                )
                invite_user = cur.fetchone()
                
                if not invite_user:
                    return jsonify({'error': 'User not found'}), 404
                
                if invite_user['id'] == user_id:
                    return jsonify({'error': 'Cannot invite yourself'}), 400
                
                # Check if already shared
                cur.execute(
                    "SELECT id, status FROM list_shares WHERE list_id = %s AND user_id = %s",
                    (list_id, invite_user['id'])
                )
                existing_share = cur.fetchone()
                
                if existing_share:
                    if existing_share['status'] == 'accepted':
                        return jsonify({'error': 'List is already shared with this user'}), 409
                    elif existing_share['status'] == 'pending':
                        return jsonify({'error': 'Invitation already pending for this user'}), 409
                
                # Get inviter info
                cur.execute(
                    "SELECT username FROM users WHERE id = %s",
                    (user_id,)
                )
                inviter = cur.fetchone()
                
                # Create the share invitation
                cur.execute("""
                    INSERT INTO list_shares (list_id, user_id, permission, status)
                    VALUES (%s, %s, %s, 'pending')
                    ON CONFLICT (list_id, user_id) 
                    DO UPDATE SET permission = EXCLUDED.permission, status = 'pending'
                    RETURNING id
                """, (list_id, invite_user['id'], permission))
                
                share_id = cur.fetchone()['id']
                
                # Mark the list as shared
                cur.execute("""
                    UPDATE shopping_lists SET is_shared = TRUE WHERE id = %s
                """, (list_id,))
                
                # Create notification
                notification_data = {
                    'list_id': list_id,
                    'list_name': list_data['name'],
                    'inviter_user_id': user_id,
                    'inviter_username': inviter['username'],
                    'permission': permission,
                    'share_id': share_id
                }
                
                cur.execute("""
                    INSERT INTO notifications (user_id, type, title, message, data)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    invite_user['id'],
                    'share_invitation',
                    f'Shopping List Invitation',
                    f'{inviter["username"]} invited you to collaborate on "{list_data["name"]}" with {permission} access',
                    psycopg2.extras.Json(notification_data)
                ))
                
                conn.commit()
                
                return jsonify({
                    'message': f'Invitation sent to {username}',
                    'invited_user': {
                        'id': invite_user['id'],
                        'username': invite_user['username']
                    }
                }), 200
                
    except Exception as e:
        print(f"Invite user error: {e}")
        return jsonify({'error': 'Failed to send invitation'}), 500

@app.route('/api/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, type, title, message, data, is_read, created_at
                    FROM notifications
                    WHERE user_id = %s
                    ORDER BY created_at DESC
                    LIMIT 50
                """, (user_id,))
                
                notifications = cur.fetchall()
                
                return jsonify({
                    'notifications': [dict(notification) for notification in notifications]
                })
                
    except Exception as e:
        print(f"Get notifications error: {e}")
        return jsonify({'error': 'Failed to get notifications'}), 500

@app.route('/api/notifications/<int:notification_id>/respond', methods=['POST'])
@jwt_required()
def respond_to_notification(notification_id):
    try:
        user_id = int(get_jwt_identity())
        data = request.json
        
        if not data or 'action' not in data:
            return jsonify({'error': 'Action is required'}), 400
        
        action = data['action']  # 'accept' or 'decline'
        
        if action not in ['accept', 'decline']:
            return jsonify({'error': 'Invalid action'}), 400
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get notification
                cur.execute("""
                    SELECT id, type, data
                    FROM notifications
                    WHERE id = %s AND user_id = %s AND type = 'share_invitation'
                """, (notification_id, user_id))
                
                notification = cur.fetchone()
                
                if not notification:
                    return jsonify({'error': 'Notification not found'}), 404
                
                notification_data = notification['data']
                share_id = notification_data['share_id']
                list_id = notification_data['list_id']
                inviter_user_id = notification_data['inviter_user_id']
                
                if action == 'accept':
                    # Update share status to accepted
                    cur.execute(
                        "UPDATE list_shares SET status = 'accepted' WHERE id = %s",
                        (share_id,)
                    )
                    
                    # Create success notification for inviter
                    cur.execute("""
                        INSERT INTO notifications (user_id, type, title, message, data)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (
                        inviter_user_id,
                        'share_accepted',
                        'Invitation Accepted',
                        f'Your invitation to share "{notification_data["list_name"]}" was accepted',
                        psycopg2.extras.Json({'list_id': list_id})
                    ))
                    
                else:  # decline
                    # Remove the share
                    cur.execute(
                        "DELETE FROM list_shares WHERE id = %s",
                        (share_id,)
                    )
                    
                    # Create declined notification for inviter
                    cur.execute("""
                        INSERT INTO notifications (user_id, type, title, message, data)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (
                        inviter_user_id,
                        'share_declined',
                        'Invitation Declined',
                        f'Your invitation to share "{notification_data["list_name"]}" was declined',
                        psycopg2.extras.Json({'list_id': list_id})
                    ))
                
                # Mark notification as read
                cur.execute(
                    "UPDATE notifications SET is_read = TRUE WHERE id = %s",
                    (notification_id,)
                )
                
                conn.commit()
                
                return jsonify({
                    'message': f'Invitation {action}ed successfully'
                }), 200
                
    except Exception as e:
        print(f"Respond to notification error: {e}")
        return jsonify({'error': 'Failed to respond to notification'}), 500

@app.route('/api/notifications/<int:notification_id>/read', methods=['PUT'])
@jwt_required()
def mark_notification_read(notification_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "UPDATE notifications SET is_read = TRUE WHERE id = %s AND user_id = %s",
                    (notification_id, user_id)
                )
                
                conn.commit()
                
                return jsonify({'message': 'Notification marked as read'}), 200
                
    except Exception as e:
        print(f"Mark notification read error: {e}")
        return jsonify({'error': 'Failed to mark notification as read'}), 500

# Sharing Management Endpoints
@app.route('/api/lists/<int:list_id>/shares', methods=['GET'])
@jwt_required()
def get_list_shares(list_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check if user owns the list
                cur.execute("""
                    SELECT owner_id FROM shopping_lists 
                    WHERE id = %s AND owner_id = %s
                """, (list_id, user_id))
                
                if not cur.fetchone():
                    return jsonify({'error': 'Access denied - not list owner'}), 403
                
                # Get all shares for this list
                cur.execute("""
                    SELECT ls.id, ls.permission, ls.status, ls.shared_at,
                           u.username, u.email
                    FROM list_shares ls
                    JOIN users u ON u.id = ls.user_id
                    WHERE ls.list_id = %s
                    ORDER BY ls.shared_at DESC
                """, (list_id,))
                
                shares = cur.fetchall()
                
                return jsonify({'shares': shares}), 200
                
    except Exception as e:
        print(f"Get list shares error: {e}")
        return jsonify({'error': 'Failed to get list shares'}), 500

@app.route('/api/lists/<int:list_id>/shares/<int:share_id>', methods=['PUT'])
@jwt_required()
def update_share_permission(list_id, share_id):
    try:
        user_id = int(get_jwt_identity())
        data = request.json
        
        if not data or 'permission' not in data:
            return jsonify({'error': 'Permission is required'}), 400
        
        permission = data['permission']
        if permission not in ['read', 'write']:
            return jsonify({'error': 'Invalid permission'}), 400
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check if user owns the list
                cur.execute("""
                    SELECT owner_id FROM shopping_lists 
                    WHERE id = %s AND owner_id = %s
                """, (list_id, user_id))
                
                if not cur.fetchone():
                    return jsonify({'error': 'Access denied - not list owner'}), 403
                
                # Update the share permission
                cur.execute("""
                    UPDATE list_shares 
                    SET permission = %s
                    WHERE id = %s AND list_id = %s
                """, (permission, share_id, list_id))
                
                if cur.rowcount == 0:
                    return jsonify({'error': 'Share not found'}), 404
                
                conn.commit()
                
                return jsonify({'message': 'Permission updated successfully'}), 200
                
    except Exception as e:
        print(f"Update share permission error: {e}")
        return jsonify({'error': 'Failed to update permission'}), 500

@app.route('/api/lists/<int:list_id>/shares/<int:share_id>', methods=['DELETE'])
@jwt_required()
def remove_share(list_id, share_id):
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check if user owns the list
                cur.execute("""
                    SELECT owner_id FROM shopping_lists 
                    WHERE id = %s AND owner_id = %s
                """, (list_id, user_id))
                
                if not cur.fetchone():
                    return jsonify({'error': 'Access denied - not list owner'}), 403
                
                # Get share info before deletion for notification
                cur.execute("""
                    SELECT ls.user_id, u.username, sl.name as list_name
                    FROM list_shares ls
                    JOIN users u ON u.id = ls.user_id  
                    JOIN shopping_lists sl ON sl.id = ls.list_id
                    WHERE ls.id = %s AND ls.list_id = %s
                """, (share_id, list_id))
                
                share_info = cur.fetchone()
                if not share_info:
                    return jsonify({'error': 'Share not found'}), 404
                
                # Delete the share
                cur.execute("""
                    DELETE FROM list_shares 
                    WHERE id = %s AND list_id = %s
                """, (share_id, list_id))
                
                # Create notification for removed user
                cur.execute("""
                    INSERT INTO notifications (user_id, type, title, message, data, is_read)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    share_info['user_id'],
                    'share_removed',
                    'Access Removed',
                    f'You no longer have access to "{share_info["list_name"]}"',
                    psycopg2.extras.Json({'list_id': list_id}),
                    False
                ))
                
                # Update list sharing status if no more shares
                cur.execute("""
                    SELECT COUNT(*) as share_count FROM list_shares WHERE list_id = %s
                """, (list_id,))
                share_count = cur.fetchone()['share_count']
                
                if share_count == 0:
                    cur.execute("""
                        UPDATE shopping_lists SET is_shared = FALSE WHERE id = %s
                    """, (list_id,))
                
                conn.commit()
                
                return jsonify({'message': 'User removed from list successfully'}), 200
                
    except Exception as e:
        print(f"Remove share error: {e}")
        return jsonify({'error': 'Failed to remove user from list'}), 500

# OIDC Authentication Endpoints

@app.route('/api/auth/oidc/login', methods=['POST'])
def oidc_login():
    """Initiate OIDC authentication flow"""
    try:
        oidc_client = create_oidc_client()
        state = secrets.token_urlsafe(32)
        
        authorization_url, _ = oidc_client.get_authorization_url(state=state)
        
        # Store state in session for validation (in production, use Redis or database)
        # For now, we'll include it in the response and validate in callback
        
        return jsonify({
            'authorization_url': authorization_url,
            'state': state
        }), 200
        
    except Exception as e:
        print(f"OIDC login error: {e}")
        return jsonify({'error': 'Failed to initiate OIDC login'}), 500

@app.route('/api/auth/oidc/callback', methods=['POST'])
def oidc_callback():
    """Handle OIDC callback and authenticate user"""
    try:
        data = request.json
        code = data.get('code')
        state = data.get('state')
        
        if not code or not state:
            return jsonify({'error': 'Missing authorization code or state'}), 400
        
        # Initialize OIDC client
        oidc_client = create_oidc_client()
        
        # Exchange code for tokens
        tokens = oidc_client.exchange_code_for_token(code, state)
        id_token = tokens.get('id_token')
        access_token = tokens.get('access_token')
        
        if not id_token:
            return jsonify({'error': 'No ID token received'}), 400
        
        # Validate ID token
        id_token_payload = oidc_client.validate_id_token(id_token)
        
        # Get additional user info if available
        user_info = None
        if access_token:
            try:
                user_info = oidc_client.get_user_info(access_token)
            except Exception:
                # User info is optional, continue without it
                pass
        
        # Extract user profile
        oidc_profile = oidc_client.extract_user_profile(id_token_payload, user_info)
        
        # Get client info for audit
        client_ip = request.environ.get('REMOTE_ADDR')
        user_agent = request.headers.get('User-Agent')
        
        # Check if this is a linking flow
        if state.startswith('link_'):
            # Extract user_id from linking state
            try:
                _, user_id_str, _ = state.split('_', 2)
                user_id = int(user_id_str)
                
                with get_db_connection() as conn:
                    sync_manager = UserSyncManager(conn)
                    
                    # Check if this Authentik account is already linked
                    existing_user = sync_manager.find_user_by_authentik_sub(oidc_profile['sub'])
                    if existing_user:
                        return jsonify({'error': 'This Authentik account is already linked to another user'}), 400
                    
                    # Link the account
                    if sync_manager.link_authentik_account(user_id, oidc_profile):
                        sync_manager.log_auth_event(user_id, 'oidc', 'account_link', True, client_ip, user_agent)
                        return jsonify({'success': True, 'message': 'Account successfully linked with Authentik'}), 200
                    else:
                        return jsonify({'error': 'Failed to link account'}), 500
                        
            except ValueError:
                return jsonify({'error': 'Invalid linking state'}), 400
        
        # Normal login flow - synchronize user account
        with get_db_connection() as conn:
            user_data, message = sync_user_with_oidc(conn, oidc_profile, client_ip, user_agent)
        
        if not user_data:
            return jsonify({'error': message}), 400
        
        # Create JWT token for the application
        access_token = create_access_token(identity=str(user_data['id']))
        
        return jsonify({
            'message': 'OIDC authentication successful',
            'user': {
                'id': user_data['id'],
                'username': user_data['username'],
                'email': user_data['email'],
                'auth_provider': user_data.get('auth_provider', 'authentik')
            },
            'token': access_token,
            'sync_message': message
        }), 200
        
    except Exception as e:
        print(f"OIDC callback error: {e}")
        return jsonify({'error': 'OIDC authentication failed'}), 500

@app.route('/api/auth/oidc/link', methods=['POST'])
@jwt_required()
def link_oidc_account():
    """Initiate OIDC authentication flow for account linking"""
    try:
        user_id = int(get_jwt_identity())
        
        # Store user ID in session for linking after OIDC callback
        oidc_client = create_oidc_client()
        state = secrets.token_urlsafe(32)
        
        # Store linking state in session or database
        # For simplicity, we'll encode user_id in the state parameter
        linking_state = f"link_{user_id}_{state}"
        
        authorization_url, _ = oidc_client.get_authorization_url(state=linking_state)
        
        return jsonify({
            'authorization_url': authorization_url,
            'state': linking_state
        }), 200
                
    except Exception as e:
        print(f"OIDC link error: {e}")
        return jsonify({'error': 'Failed to link OIDC account'}), 500

@app.route('/api/auth/oidc/unlink', methods=['POST'])
@jwt_required()
def unlink_oidc_account():
    """Unlink Authentik account from current user"""
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            sync_manager = UserSyncManager(conn)
            
            if sync_manager.unlink_authentik_account(user_id):
                client_ip = request.environ.get('REMOTE_ADDR')
                user_agent = request.headers.get('User-Agent')
                sync_manager.log_auth_event(user_id, 'oidc', 'account_unlink', True, client_ip, user_agent)
                
                return jsonify({'message': 'Authentik account successfully unlinked'}), 200
            else:
                return jsonify({'error': 'Cannot unlink account - you need a local password to maintain access'}), 400
                
    except Exception as e:
        print(f"OIDC unlink error: {e}")
        return jsonify({'error': 'Failed to unlink OIDC account'}), 500

@app.route('/api/auth/oidc/status', methods=['GET'])
@jwt_required()
def oidc_status():
    """Get OIDC linking status for current user"""
    try:
        user_id = int(get_jwt_identity())
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT authentik_sub, auth_provider, linked_at, last_oidc_login
                    FROM users WHERE id = %s
                """, (user_id,))
                user = cur.fetchone()
                
                if not user:
                    return jsonify({'error': 'User not found'}), 404
                
                return jsonify({
                    'is_linked': bool(user['authentik_sub']),
                    'auth_provider': user['auth_provider'],
                    'linked_at': user['linked_at'].isoformat() if user['linked_at'] else None,
                    'last_oidc_login': user['last_oidc_login'].isoformat() if user['last_oidc_login'] else None
                }), 200
                
    except Exception as e:
        print(f"OIDC status error: {e}")
        return jsonify({'error': 'Failed to get OIDC status'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 3001)), debug=os.getenv('NODE_ENV') != 'production')