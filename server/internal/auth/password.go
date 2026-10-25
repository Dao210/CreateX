package auth

import (
	"errors"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var ErrPasswordLength = errors.New("password must contain at least 8 characters and at most 72 bytes")

func HashPassword(password string) (string, error) {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 8 || len(password) > 72 {
		return "", ErrPasswordLength
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

// A fixed, valid hash keeps unknown and passwordless accounts on the same
// expensive comparison path as accounts with a password.
const dummyPasswordHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

func CheckPassword(hash, password string) bool {
	stored := hash
	if stored == "" {
		stored = dummyPasswordHash
	}
	err := bcrypt.CompareHashAndPassword([]byte(stored), []byte(password))
	return hash != "" && len(password) <= 72 && err == nil
}
