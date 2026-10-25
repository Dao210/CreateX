package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/auro-ai/auro/server/internal/siege"
	"github.com/auro-ai/auro/server/pkg/llm"
)

// cookieIdentity gives standalone mode an owner without Auro accounts: the same
// anonymous siege_owner cookie the pre-integration server issued. The main
// server never uses this path — it injects the workspace member instead.
func cookieIdentity(secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := ""
			if c, err := r.Cookie("siege_owner"); err == nil && len(c.Value) == 64 {
				if _, err := hex.DecodeString(c.Value); err == nil {
					token = c.Value
				}
			}
			if token == "" {
				buf := make([]byte, 32)
				if _, err := rand.Read(buf); err != nil {
					http.Error(w, `{"code":"storage_unavailable"}`, http.StatusInternalServerError)
					return
				}
				token = hex.EncodeToString(buf)
				http.SetCookie(w, &http.Cookie{Name: "siege_owner", Value: token, Path: "/api/siege", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: secure || r.TLS != nil, MaxAge: 30 * 86400})
			}
			next.ServeHTTP(w, r.WithContext(siege.WithOwner(r.Context(), siege.Owner{UserID: token})))
		})
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	store, err := siege.OpenStore(env("SIEGE_DATA_DIR", ".siege/data"))
	if err != nil {
		slog.Error("open siege storage", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	mode := env("SIEGE_RECOGNITION_MODE", "llm")
	ready := false
	var recognizer siege.Recognizer
	switch mode {
	case "fixture":
		recognizer = siege.FixtureRecognizer{}
		ready = true
	case "llm":
		retries, _ := llm.Retries(0)
		model := os.Getenv("SIEGE_LLM_MODEL")
		client := llm.New(llm.Config{APIKey: os.Getenv("SIEGE_LLM_API_KEY"), BaseURL: os.Getenv("SIEGE_LLM_BASE_URL"), DefaultModel: model, MaxRetries: retries})
		ready = client.Enabled() && strings.TrimSpace(model) != ""
		recognizer = siege.VisionRecognizer{Client: client, Model: model}
	default:
		slog.Error("SIEGE_RECOGNITION_MODE must be llm or fixture")
		os.Exit(1)
	}
	budget, err := strconv.Atoi(env("SIEGE_DAILY_RECOGNITION_LIMIT", "100"))
	if err != nil || budget < 1 || budget > 10000 {
		slog.Error("invalid recognition budget")
		os.Exit(1)
	}
	secure := os.Getenv("SIEGE_SECURE_COOKIES") == "true"
	api := (&siege.HTTP{Service: siege.NewService(store, recognizer, mode, ready, budget), SecureCookies: secure, EnforceOrigin: true}).Handler()
	assets := filepath.Clean(env("SIEGE_ASSETS_DIR", "../apps/siege/dist"))
	files := http.StripPrefix("/siege/", http.FileServer(http.Dir(assets)))
	mux := http.NewServeMux()
	mux.Handle("/api/siege/", cookieIdentity(secure)(api))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/siege" {
			http.Redirect(w, r, "/siege/", http.StatusTemporaryRedirect)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/siege/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: env("SIEGE_LISTEN_ADDR", "127.0.0.1:18107"), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	slog.Info("siege listening", "address", server.Addr, "recognition_mode", mode, "model_ready", ready)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("siege server failed", "error", err)
		os.Exit(1)
	}
}
