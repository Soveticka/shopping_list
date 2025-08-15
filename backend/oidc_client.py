#!/usr/bin/env python3
"""
Authentik OIDC Client Implementation
Handles OpenID Connect authentication flow with Authentik
"""

import os
import secrets
import time
import requests
import jwt
from urllib.parse import urlencode, parse_qs
from typing import Dict, Optional, Tuple
from requests_oauthlib import OAuth2Session


class AuthentikOIDCClient:
    """
    OIDC client for Authentik integration
    Handles authorization code flow with PKCE support
    """
    
    def __init__(self, client_id: str, client_secret: str, discovery_url: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.discovery_url = discovery_url
        self.redirect_uri = redirect_uri
        self._discovery_cache = None
        self._jwks_cache = None
        self._cache_expires = 0
        
    def _get_discovery_info(self) -> Dict:
        """Get OIDC discovery information with caching"""
        current_time = time.time()
        
        if self._discovery_cache and current_time < self._cache_expires:
            return self._discovery_cache
        
        try:
            response = requests.get(self.discovery_url, timeout=10)
            response.raise_for_status()
            self._discovery_cache = response.json()
            # Cache for 1 hour
            self._cache_expires = current_time + 3600
            return self._discovery_cache
        except requests.RequestException as e:
            raise Exception(f"Failed to fetch OIDC discovery info: {e}")
    
    def _get_jwks(self) -> Dict:
        """Get JSON Web Key Set for token validation"""
        discovery = self._get_discovery_info()
        jwks_uri = discovery.get('jwks_uri')
        
        if not jwks_uri:
            raise Exception("No jwks_uri found in discovery document")
        
        try:
            response = requests.get(jwks_uri, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            raise Exception(f"Failed to fetch JWKS: {e}")
    
    def get_authorization_url(self, state: str = None, scopes: list = None) -> Tuple[str, str]:
        """
        Generate authorization URL for OIDC login
        Returns: (authorization_url, state)
        """
        discovery = self._get_discovery_info()
        authorization_endpoint = discovery.get('authorization_endpoint')
        
        if not authorization_endpoint:
            raise Exception("No authorization_endpoint found in discovery document")
        
        if not state:
            state = secrets.token_urlsafe(32)
        
        if not scopes:
            scopes = ['openid', 'profile', 'email']
        
        oauth = OAuth2Session(
            client_id=self.client_id,
            redirect_uri=self.redirect_uri,
            scope=scopes,
            state=state
        )
        
        authorization_url, _ = oauth.authorization_url(
            authorization_endpoint,
            state=state
        )
        
        return authorization_url, state
    
    def exchange_code_for_token(self, code: str, state: str) -> Dict:
        """
        Exchange authorization code for access token and ID token
        """
        discovery = self._get_discovery_info()
        token_endpoint = discovery.get('token_endpoint')
        
        if not token_endpoint:
            raise Exception("No token_endpoint found in discovery document")
        
        oauth = OAuth2Session(
            client_id=self.client_id,
            redirect_uri=self.redirect_uri,
            state=state
        )
        
        try:
            token = oauth.fetch_token(
                token_endpoint,
                code=code,
                client_secret=self.client_secret,
                include_client_id=True
            )
            return token
        except Exception as e:
            raise Exception(f"Failed to exchange code for token: {e}")
    
    def validate_id_token(self, id_token: str) -> Dict:
        """
        Validate and decode ID token
        Returns decoded token payload
        """
        try:
            # Get JWKS for signature verification
            jwks = self._get_jwks()
            
            # Decode header to get key ID
            unverified_header = jwt.get_unverified_header(id_token)
            kid = unverified_header.get('kid')
            
            # Find the correct key
            signing_key = None
            for key in jwks.get('keys', []):
                if key.get('kid') == kid:
                    signing_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                    break
            
            if not signing_key:
                raise Exception(f"Unable to find signing key with kid: {kid}")
            
            # Verify and decode token
            payload = jwt.decode(
                id_token,
                signing_key,
                algorithms=['RS256'],
                audience=self.client_id,
                options={
                    "verify_signature": True,
                    "verify_aud": True,
                    "verify_iat": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iss": True,
                    "require_aud": True,
                    "require_iat": True,
                    "require_exp": True,
                    "require_nbf": False,
                }
            )
            
            return payload
        except jwt.InvalidTokenError as e:
            raise Exception(f"Invalid ID token: {e}")
        except Exception as e:
            raise Exception(f"Token validation failed: {e}")
    
    def get_user_info(self, access_token: str) -> Dict:
        """
        Get user information from userinfo endpoint
        """
        discovery = self._get_discovery_info()
        userinfo_endpoint = discovery.get('userinfo_endpoint')
        
        if not userinfo_endpoint:
            raise Exception("No userinfo_endpoint found in discovery document")
        
        headers = {
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.get(userinfo_endpoint, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            raise Exception(f"Failed to get user info: {e}")
    
    def extract_user_profile(self, id_token_payload: Dict, user_info: Dict = None) -> Dict:
        """
        Extract standardized user profile from OIDC tokens
        """
        # Merge ID token and userinfo claims (userinfo takes precedence)
        profile = id_token_payload.copy()
        if user_info:
            profile.update(user_info)
        
        # Standardize field names
        return {
            'sub': profile.get('sub'),
            'username': profile.get('preferred_username') or profile.get('nickname'),
            'email': profile.get('email'),
            'email_verified': profile.get('email_verified', False),
            'name': profile.get('name'),
            'given_name': profile.get('given_name'),
            'family_name': profile.get('family_name'),
            'picture': profile.get('picture'),
            'groups': profile.get('groups', []),
            'raw_profile': profile
        }


def create_oidc_client() -> AuthentikOIDCClient:
    """
    Factory function to create OIDC client with environment configuration
    """
    client_id = os.getenv('OIDC_CLIENT_ID')
    client_secret = os.getenv('OIDC_CLIENT_SECRET')
    discovery_url = os.getenv('OIDC_DISCOVERY_URL')
    redirect_uri = os.getenv('OIDC_REDIRECT_URI')
    
    if not all([client_id, client_secret, discovery_url, redirect_uri]):
        raise ValueError("Missing required OIDC environment variables")
    
    return AuthentikOIDCClient(
        client_id=client_id,
        client_secret=client_secret,
        discovery_url=discovery_url,
        redirect_uri=redirect_uri
    )