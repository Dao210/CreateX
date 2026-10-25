package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/auth"
	"github.com/auro-ai/auro/server/internal/testutil"
)

func TestPasswordRegistrationAndReset(t *testing.T) {
	email := "password-registration@example.com"
	dbfx.Cleanup(t, `DELETE FROM "user" WHERE email = $1`, email)
	for i, password := range []string{"first-password", "changed-password"} {
		code := "123456"
		dbfx.Insert(t, "verification_code", testutil.Cols{"email": email, "code": code, "expires_at": testutil.Raw("now() + interval '10 minutes'")})
		body := map[string]string{"email": " PASSWORD-REGISTRATION@example.com ", "code": code, "password": password}
		var login LoginResponse
		resp := testutil.Call(t, testHandler.VerifyCode, testutil.JSONRequest(http.MethodPost, "/auth/verify-code", body)).Want(http.StatusOK)
		resp.JSON(&login)
		if login.Token == "" || login.User.Email != email || len(resp.Result().Cookies()) == 0 {
			t.Fatal("verified password setup must establish the normal authenticated session")
		}
		if strings.Contains(resp.Body.String(), "password_hash") || strings.Contains(resp.Body.String(), password) {
			t.Fatal("authentication response leaked a password or hash")
		}
		user, err := testHandler.Queries.GetUserByEmail(context.Background(), email)
		if err != nil || !auth.CheckPassword(user.PasswordHash, password) {
			t.Fatalf("password was not stored as a valid hash: %v", err)
		}
		testutil.Call(t, testHandler.VerifyCode, testutil.JSONRequest(http.MethodPost, "/auth/verify-code", body)).Want(http.StatusBadRequest)
		testutil.Call(t, testHandler.PasswordLogin, testutil.JSONRequest(http.MethodPost, "/auth/login", map[string]string{"email": email, "password": password})).Want(http.StatusOK)
		if i == 1 {
			testutil.Call(t, testHandler.PasswordLogin, testutil.JSONRequest(http.MethodPost, "/auth/login", map[string]string{"email": email, "password": "first-password"})).Want(http.StatusUnauthorized)
		}
	}
}

func TestPasswordSetupRejectsInvalidProofAndWeakPasswords(t *testing.T) {
	email := "password-proof@example.com"
	id := dbfx.User(t, "Password Proof", email)
	dbfx.Insert(t, "verification_code", testutil.Cols{"email": email, "code": "123456", "expires_at": testutil.Raw("now() + interval '10 minutes'")})
	for _, body := range []map[string]string{
		{"email": email, "code": "000000", "password": "new-password"},
		{"email": email, "code": "123456", "password": "short"},
		{"email": email, "code": "123456", "password": ""},
	} {
		resp := testutil.Call(t, testHandler.VerifyCode, testutil.JSONRequest(http.MethodPost, "/auth/verify-code", body)).Want(http.StatusBadRequest)
		if len(resp.Result().Cookies()) != 0 {
			t.Fatal("rejected setup issued authentication cookies")
		}
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM "user" WHERE id = $1 AND password_hash <> ''`, id); n != 0 {
		t.Fatal("invalid proof changed the password")
	}
	if _, err := testHandler.Queries.GetLatestVerificationCode(context.Background(), email); err != nil {
		t.Fatal("weak password must not consume a valid code")
	}
}

func TestPasswordLoginRejectsUnknownPasswordlessAndDisabledAccounts(t *testing.T) {
	dbfx.User(t, "Passwordless", "passwordless@example.com")
	hash, err := auth.HashPassword("valid-password")
	if err != nil {
		t.Fatal(err)
	}
	dbfx.User(t, "Disabled", "pdzzer68@embassybase.com", testutil.Cols{"password_hash": hash})
	for _, email := range []string{"missing-password@example.com", "passwordless@example.com", "pdzzer68@embassybase.com"} {
		want := http.StatusUnauthorized
		if email == "pdzzer68@embassybase.com" {
			want = http.StatusForbidden
		}
		resp := testutil.Call(t, testHandler.PasswordLogin, testutil.JSONRequest(http.MethodPost, "/auth/login", map[string]string{"email": email, "password": "valid-password"})).Want(want)
		if len(resp.Result().Cookies()) != 0 {
			t.Fatal("rejected login established a session")
		}
	}
}

func TestPasswordLoginRateLimitsWithoutRedis(t *testing.T) {
	h := *testHandler
	h.PasswordLoginLimiter = newMemorySlidingWindowRateLimiter(SlidingWindowRateLimit{Limit: 1, Window: time.Minute})
	for i, email := range []string{" Throttled@example.com ", "throttled@example.com"} {
		want := http.StatusUnauthorized
		if i == 1 {
			want = http.StatusTooManyRequests
		}
		resp := testutil.Call(t, h.PasswordLogin, testutil.JSONRequest(http.MethodPost, "/auth/login", map[string]string{"email": email, "password": "wrong-password"})).Want(want)
		if i == 1 && resp.Result().Header.Get("Retry-After") == "" {
			t.Fatal("missing retry hint")
		}
	}
}

type unavailablePasswordLimiter struct{}

func (unavailablePasswordLimiter) Allow(context.Context, string) bool { return true }
func (unavailablePasswordLimiter) AllowWithError(context.Context, string) (bool, error) {
	return false, errors.New("rate limit store unavailable")
}

func TestPasswordLoginFailsClosedWhenRateLimitStoreIsUnavailable(t *testing.T) {
	h := *testHandler
	h.PasswordLoginLimiter = unavailablePasswordLimiter{}
	testutil.Call(t, h.PasswordLogin, testutil.JSONRequest(http.MethodPost, "/auth/login", map[string]string{
		"email": "unavailable@example.com", "password": "valid-password",
	})).Want(http.StatusServiceUnavailable)
}

func TestPasswordSetupRechecksSignupPolicyAndInvalidatesOlderCodes(t *testing.T) {
	email := "password-signup-policy@example.com"
	dbfx.Cleanup(t, `DELETE FROM "user" WHERE email = $1`, email)
	dbfx.Insert(t, "verification_code", testutil.Cols{
		"email": email, "code": "123456", "expires_at": testutil.Raw("now() + interval '10 minutes'"),
		"created_at": testutil.Raw("now() - interval '2 minutes'"),
	})
	dbfx.Insert(t, "verification_code", testutil.Cols{
		"email": email, "code": "654321", "expires_at": testutil.Raw("now() + interval '10 minutes'"),
	})
	h := *testHandler
	h.cfg = Config{AllowSignup: false}
	body := map[string]string{"email": email, "code": "654321", "password": "new-password"}
	testutil.Call(t, h.VerifyCode, testutil.JSONRequest(http.MethodPost, "/auth/verify-code", body)).Want(http.StatusForbidden)
	if n := dbfx.Count(t, `SELECT count(*) FROM "user" WHERE email = $1`, email); n != 0 {
		t.Fatal("password signup bypassed the registration policy")
	}
	// The rejected transaction must leave the code available for a retry.
	testutil.Call(t, testHandler.VerifyCode, testutil.JSONRequest(http.MethodPost, "/auth/verify-code", body)).Want(http.StatusOK)
	body["code"] = "123456"
	testutil.Call(t, testHandler.VerifyCode, testutil.JSONRequest(http.MethodPost, "/auth/verify-code", body)).Want(http.StatusBadRequest)
}

func TestPasswordCodeCanOnlyBeConsumedOnceConcurrently(t *testing.T) {
	email := "password-concurrent@example.com"
	dbfx.User(t, "Concurrent", email)
	dbfx.Insert(t, "verification_code", testutil.Cols{"email": email, "code": "123456", "expires_at": testutil.Raw("now() + interval '10 minutes'")})
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for range 2 {
		wg.Go(func() {
			body, _ := json.Marshal(map[string]string{"email": email, "code": "123456", "password": "new-password"})
			r := httptest.NewRequest(http.MethodPost, "/auth/verify-code", strings.NewReader(string(body)))
			w := httptest.NewRecorder()
			testHandler.VerifyCode(w, r)
			statuses <- w.Code
		})
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[http.StatusOK] != 1 || counts[http.StatusBadRequest] != 1 {
		t.Fatalf("expected one successful code consumption: %v", counts)
	}
}
