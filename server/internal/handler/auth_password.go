package handler

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/auro-ai/auro/server/internal/auth"
	"github.com/redis/go-redis/v9"
)

// NewRedisPasswordLoginLimiter shares account budgets across server instances.
func NewRedisPasswordLoginLimiter(rdb redis.UniversalClient) SlidingWindowRateLimiter {
	return newRedisSlidingWindowRateLimiter(rdb, SlidingWindowRateLimit{Limit: 10, Window: 15 * time.Minute}, "auro:auth:password:email:")
}

func (h *Handler) PasswordLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || req.Password == "" {
		writeError(w, http.StatusBadRequest, "email and password are required")
		return
	}
	// These local gates remain active without Redis. The router adds its
	// shared Redis IP budget when configured.
	if h.PasswordIPLimiter == nil || h.PasswordLoginLimiter == nil {
		writeError(w, http.StatusServiceUnavailable, "password login unavailable")
		return
	}
	ipAllowed := h.PasswordIPLimiter.Allow(r.Context(), h.clientIPForRateLimit(r))
	accountAllowed, limitErr := slidingWindowLimiterAllow(r.Context(), h.PasswordLoginLimiter, email)
	if limitErr != nil {
		writeError(w, http.StatusServiceUnavailable, "password login unavailable; try a verification code")
		return
	}
	if !ipAllowed || !accountAllowed {
		w.Header().Set("Retry-After", "900")
		writeError(w, http.StatusTooManyRequests, "too many login attempts; try again later or use a verification code")
		return
	}
	user, err := h.Queries.GetUserByEmail(r.Context(), email)
	if err != nil && !isNotFound(err) {
		writeError(w, http.StatusInternalServerError, "failed to lookup user")
		return
	}
	if !auth.CheckPassword(user.PasswordHash, req.Password) || err != nil {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if auth.IsTemporarilyDisabledUser(uuidToString(user.ID), user.Email) {
		writeError(w, http.StatusForbidden, auth.TemporarilyDisabledUserError)
		return
	}
	h.respondWithLogin(w, r, user)
}
