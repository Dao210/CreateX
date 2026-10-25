package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestPasswordHashAndCheck(t *testing.T) {
	password := " 密码🪐 with spaces "
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	second, err := HashPassword(password)
	if err != nil || second == hash || hash == password {
		t.Fatal("password hashes must be independently salted")
	}
	if !CheckPassword(hash, password) || CheckPassword(hash, strings.TrimSpace(password)) || CheckPassword("", password) {
		t.Fatal("password verification must preserve whitespace and reject unset passwords")
	}
}

func TestPasswordLength(t *testing.T) {
	for _, password := range []string{"", "1234567", "中文四字", strings.Repeat("a", 73), strings.Repeat("中", 25)} {
		if _, err := HashPassword(password); !errors.Is(err, ErrPasswordLength) {
			t.Errorf("expected length error for %d bytes, got %v", len(password), err)
		}
	}
	for _, password := range []string{strings.Repeat("a", 8), strings.Repeat("a", 72), strings.Repeat("中", 24)} {
		if _, err := HashPassword(password); err != nil {
			t.Errorf("valid %d-byte password: %v", len(password), err)
		}
	}
}
