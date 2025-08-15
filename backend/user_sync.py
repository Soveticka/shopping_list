#!/usr/bin/env python3
"""
User Synchronization Logic for Authentik Integration
Handles account matching, linking, and creation from OIDC profiles
"""

import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Dict, Optional, Tuple, List
from enum import Enum


class SyncResult(Enum):
    """Possible outcomes of user synchronization"""
    EXISTING_LINK = "existing_link"
    USERNAME_MATCH = "username_match"
    EMAIL_MATCH = "email_match"
    EMAIL_CONFLICT = "email_conflict"
    CREATE_NEW = "create_new"
    ERROR = "error"


class UserSyncManager:
    """
    Manages user account synchronization between local and Authentik accounts
    """
    
    def __init__(self, db_connection):
        self.conn = db_connection
    
    def find_user_by_authentik_sub(self, authentik_sub: str) -> Optional[Dict]:
        """Find user by Authentik subject ID"""
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM users WHERE authentik_sub = %s",
                (authentik_sub,)
            )
            return cur.fetchone()
    
    def find_user_by_username(self, username: str) -> Optional[Dict]:
        """Find user by username (case-insensitive)"""
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM users WHERE LOWER(username) = LOWER(%s)",
                (username,)
            )
            return cur.fetchone()
    
    def find_user_by_email(self, email: str) -> Optional[Dict]:
        """Find user by email (case-insensitive)"""
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM users WHERE LOWER(email) = LOWER(%s)",
                (email,)
            )
            return cur.fetchone()
    
    def resolve_user_account(self, oidc_profile: Dict) -> Tuple[SyncResult, Optional[Dict], str]:
        """
        Resolve which user account to use/create for OIDC profile
        Returns: (result_type, user_data, message)
        """
        authentik_sub = oidc_profile.get('sub')
        username = oidc_profile.get('username')
        email = oidc_profile.get('email')
        
        if not authentik_sub:
            return SyncResult.ERROR, None, "Missing subject ID in OIDC profile"
        
        if not username and not email:
            return SyncResult.ERROR, None, "Missing username and email in OIDC profile"
        
        # 1. Check if account is already linked
        existing_link = self.find_user_by_authentik_sub(authentik_sub)
        if existing_link:
            return SyncResult.EXISTING_LINK, existing_link, f"Account already linked to user {existing_link['username']}"
        
        # 2. Check for exact username match (priority for synchronization)
        if username:
            user_by_username = self.find_user_by_username(username)
            if user_by_username and not user_by_username['authentik_sub']:
                # Username matches and not yet linked to Authentik
                return SyncResult.USERNAME_MATCH, user_by_username, f"Exact username match: {username}"
        
        # 3. Check for email match
        if email:
            user_by_email = self.find_user_by_email(email)
            if user_by_email and not user_by_email['authentik_sub']:
                if user_by_email['username'].lower() != (username or '').lower():
                    # Email matches but username is different - needs confirmation
                    return SyncResult.EMAIL_CONFLICT, user_by_email, f"Email matches but usernames differ: local='{user_by_email['username']}' vs authentik='{username}'"
                else:
                    # Email and username both match
                    return SyncResult.EMAIL_MATCH, user_by_email, f"Email match: {email}"
        
        # 4. No matches found - create new user
        return SyncResult.CREATE_NEW, None, "No matching account found, will create new user"
    
    def link_authentik_account(self, user_id: int, oidc_profile: Dict, keep_local: bool = True) -> bool:
        """
        Link existing local account with Authentik
        keep_local: If True, sets auth_provider to 'both', if False sets to 'authentik'
        """
        try:
            with self.conn.cursor() as cur:
                if keep_local:
                    # Manual linking - keep both authentication methods
                    cur.execute("""
                        UPDATE users 
                        SET authentik_sub = %s,
                            auth_provider = CASE 
                                WHEN auth_provider = 'local' THEN 'both'
                                ELSE auth_provider
                            END,
                            linked_at = CURRENT_TIMESTAMP,
                            last_oidc_login = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (oidc_profile['sub'], user_id))
                else:
                    # Automatic linking - switch to Authentik only
                    cur.execute("""
                        UPDATE users 
                        SET authentik_sub = %s,
                            auth_provider = 'authentik',
                            linked_at = CURRENT_TIMESTAMP,
                            last_oidc_login = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, (oidc_profile['sub'], user_id))
                
                self.conn.commit()
                return True
        except psycopg2.Error:
            self.conn.rollback()
            return False
    
    def create_user_from_oidc(self, oidc_profile: Dict) -> Optional[Dict]:
        """
        Create new user account from OIDC profile
        """
        username = oidc_profile.get('username')
        email = oidc_profile.get('email')
        authentik_sub = oidc_profile.get('sub')
        name = oidc_profile.get('name', '')
        
        if not username or not email:
            return None
        
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Create user with Authentik provider (no password_hash)
                cur.execute("""
                    INSERT INTO users (username, email, password_hash, authentik_sub, auth_provider, linked_at, last_oidc_login)
                    VALUES (%s, %s, NULL, %s, 'authentik', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id, username, email, authentik_sub, auth_provider, created_at
                """, (username, email, authentik_sub))
                
                user = cur.fetchone()
                self.conn.commit()
                return user
        except psycopg2.IntegrityError:
            # Username or email already exists
            self.conn.rollback()
            return None
        except psycopg2.Error:
            self.conn.rollback()
            return None
    
    def update_last_oidc_login(self, user_id: int) -> bool:
        """Update last OIDC login timestamp"""
        try:
            with self.conn.cursor() as cur:
                cur.execute("""
                    UPDATE users 
                    SET last_oidc_login = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (user_id,))
                
                self.conn.commit()
                return True
        except psycopg2.Error:
            self.conn.rollback()
            return False
    
    def unlink_authentik_account(self, user_id: int) -> bool:
        """
        Unlink Authentik account from local user
        Only works if user has local password
        """
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Check if user has local password
                cur.execute(
                    "SELECT password_hash FROM users WHERE id = %s",
                    (user_id,)
                )
                user = cur.fetchone()
                
                if not user or not user['password_hash']:
                    # Cannot unlink - user would have no way to authenticate
                    return False
                
                # Unlink Authentik account
                cur.execute("""
                    UPDATE users 
                    SET authentik_sub = NULL,
                        auth_provider = 'local',
                        linked_at = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                """, (user_id,))
                
                self.conn.commit()
                return True
        except psycopg2.Error:
            self.conn.rollback()
            return False
    
    def get_users_by_auth_provider(self, provider: str) -> List[Dict]:
        """Get users by authentication provider"""
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, username, email, auth_provider, linked_at, last_oidc_login FROM users WHERE auth_provider = %s",
                (provider,)
            )
            return cur.fetchall()
    
    def log_auth_event(self, user_id: int, auth_method: str, event_type: str, 
                      success: bool, ip_address: str = None, user_agent: str = None, 
                      error_message: str = None) -> bool:
        """Log authentication event for audit purposes"""
        try:
            with self.conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO auth_audit (user_id, auth_method, event_type, success, ip_address, user_agent, error_message)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (user_id, auth_method, event_type, success, ip_address, user_agent, error_message))
                
                self.conn.commit()
                return True
        except psycopg2.Error:
            self.conn.rollback()
            return False


def sync_user_with_oidc(db_connection, oidc_profile: Dict, client_ip: str = None, user_agent: str = None) -> Tuple[Optional[Dict], str]:
    """
    Main synchronization function
    Returns: (user_data, message)
    """
    print(f"OIDC Sync Debug - Profile: {oidc_profile}")
    sync_manager = UserSyncManager(db_connection)
    
    try:
        # Resolve what to do with this OIDC profile
        result_type, user_data, message = sync_manager.resolve_user_account(oidc_profile)
        print(f"OIDC Sync Debug - Result: {result_type}, User: {user_data}, Message: {message}")
        
        if result_type == SyncResult.EXISTING_LINK:
            # User already linked, just update login timestamp
            sync_manager.update_last_oidc_login(user_data['id'])
            sync_manager.log_auth_event(user_data['id'], 'oidc', 'login', True, client_ip, user_agent)
            return user_data, message
        
        elif result_type == SyncResult.USERNAME_MATCH:
            # Automatic linking by username - switch to Authentik only
            if sync_manager.link_authentik_account(user_data['id'], oidc_profile, keep_local=False):
                sync_manager.log_auth_event(user_data['id'], 'oidc', 'account_link', True, client_ip, user_agent)
                # Refresh user data
                updated_user = sync_manager.find_user_by_authentik_sub(oidc_profile['sub'])
                return updated_user, f"Account automatically linked for user {user_data['username']}"
            else:
                sync_manager.log_auth_event(user_data['id'], 'oidc', 'account_link', False, client_ip, user_agent, "Database error")
                return None, "Failed to link accounts"
        
        elif result_type == SyncResult.EMAIL_MATCH:
            # Email matches, automatic linking
            if sync_manager.link_authentik_account(user_data['id'], oidc_profile):
                sync_manager.log_auth_event(user_data['id'], 'oidc', 'account_link', True, client_ip, user_agent)
                updated_user = sync_manager.find_user_by_authentik_sub(oidc_profile['sub'])
                return updated_user, f"Account automatically linked by email for user {user_data['username']}"
            else:
                sync_manager.log_auth_event(user_data['id'], 'oidc', 'account_link', False, client_ip, user_agent, "Database error")
                return None, "Failed to link accounts"
        
        elif result_type == SyncResult.EMAIL_CONFLICT:
            # Email matches but username differs - needs manual resolution
            return None, f"Account conflict: {message}. Manual linking required."
        
        elif result_type == SyncResult.CREATE_NEW:
            # Create new user from OIDC profile
            new_user = sync_manager.create_user_from_oidc(oidc_profile)
            if new_user:
                sync_manager.log_auth_event(new_user['id'], 'oidc', 'login', True, client_ip, user_agent)
                return new_user, f"Created new account for {new_user['username']}"
            else:
                sync_manager.log_auth_event(None, 'oidc', 'login', False, client_ip, user_agent, "Failed to create user")
                return None, "Failed to create new user account"
        
        else:
            # Error case
            sync_manager.log_auth_event(None, 'oidc', 'login', False, client_ip, user_agent, message)
            return None, message
            
    except Exception as e:
        sync_manager.log_auth_event(None, 'oidc', 'login', False, client_ip, user_agent, str(e))
        return None, f"Synchronization error: {e}"