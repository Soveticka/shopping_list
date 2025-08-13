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

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Configuration
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET', 'your-super-secret-jwt-key-change-this-in-production')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)

# Initialize extensions
jwt = JWTManager(app)
CORS(app, origins=os.getenv('FRONTEND_URL', 'http://localhost:3000'))

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
    email = fields.Email(required=True)
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
                print(f"Creating shopping list for user {user['id']}")
                cur.execute(
                    "INSERT INTO shopping_lists (name, owner_id) VALUES (%s, %s) RETURNING id",
                    ('My Shopping List', user['id'])
                )
                list_result = cur.fetchone()
                list_id = list_result['id']
                print(f"Created shopping list with ID: {list_id}")
                
                # Add sample items to the list
                sample_items = [
                    ('Milk', 1, 'dairy', 'medium', 'Organic preferred'),
                    ('Bananas', 6, 'produce', 'low', 'Not too ripe'),
                    ('Chicken Breast', 2, 'meat', 'high', '1 lb package'),
                    ('Bread', 1, 'bakery', 'medium', 'Whole wheat'),
                    ('Greek Yogurt', 2, 'dairy', 'low', 'Vanilla flavor')
                ]
                
                for item_name, quantity, category, priority, notes in sample_items:
                    print(f"Adding sample item: {item_name}")
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
                
                print(f"Added {len(sample_items)} sample items to list {list_id}")
                
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
        
        email = data['email']
        password = data['password']
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, username, email, password_hash FROM users WHERE email = %s",
                    (email,)
                )
                user = cur.fetchone()
                
                if not user or not bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
                    return jsonify({'error': 'Invalid email or password'}), 401
                
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
                cur.execute("""
                    SELECT 
                        sl.id, sl.name, sl.is_shared, sl.created_at, sl.updated_at,
                        COUNT(sli.id) as item_count,
                        COUNT(CASE WHEN sli.completed = true THEN 1 END) as completed_count,
                        COALESCE((sl.id = u.default_list_id), false) as is_default
                    FROM shopping_lists sl
                    LEFT JOIN shopping_list_items sli ON sl.id = sli.list_id
                    LEFT JOIN users u ON u.id = sl.owner_id
                    WHERE sl.owner_id = %s
                    GROUP BY sl.id, u.default_list_id
                    ORDER BY sl.updated_at DESC
                """, (user_id,))
                
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
                # Get list info
                cur.execute("""
                    SELECT id, name, is_shared, created_at, updated_at
                    FROM shopping_lists
                    WHERE id = %s AND owner_id = %s
                """, (list_id, user_id))
                
                list_data = cur.fetchone()
                if not list_data:
                    return jsonify({'error': 'Shopping list not found'}), 404
                
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
                # Verify list ownership
                cur.execute(
                    "SELECT id FROM shopping_lists WHERE id = %s AND owner_id = %s",
                    (list_id, user_id)
                )
                if not cur.fetchone():
                    return jsonify({'error': 'Shopping list not found'}), 404
                
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 3001)), debug=os.getenv('NODE_ENV') != 'production')