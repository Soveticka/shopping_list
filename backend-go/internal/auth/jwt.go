package auth

import (
	"fmt"
	"shopping-list/internal/config"
	"shopping-list/internal/models"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	jwt.RegisteredClaims
}

type JWTManager struct {
	secret    []byte
	expiresIn time.Duration
}

func NewJWTManager(cfg config.JWTConfig) *JWTManager {
	expiresIn := 7 * 24 * time.Hour // default 7 days
	
	// Parse duration from config
	if duration, err := time.ParseDuration(cfg.ExpiresIn); err == nil {
		expiresIn = duration
	} else if duration, err := strconv.Atoi(cfg.ExpiresIn[:len(cfg.ExpiresIn)-1]); err == nil {
		switch cfg.ExpiresIn[len(cfg.ExpiresIn)-1] {
		case 'd':
			expiresIn = time.Duration(duration) * 24 * time.Hour
		case 'h':
			expiresIn = time.Duration(duration) * time.Hour
		case 'm':
			expiresIn = time.Duration(duration) * time.Minute
		}
	}

	return &JWTManager{
		secret:    []byte(cfg.Secret),
		expiresIn: expiresIn,
	}
}

func (j *JWTManager) GenerateToken(user *models.User) (string, error) {
	claims := Claims{
		UserID:   user.ID,
		Username: user.Username,
		Email:    user.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(j.expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(j.secret)
}

func (j *JWTManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return j.secret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}