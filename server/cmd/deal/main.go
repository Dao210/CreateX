package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/auro-ai/auro/server/internal/deal"
	"github.com/auro-ai/auro/server/pkg/llm"
)

func env(key, value string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return value
}
func main() {
	store, err := deal.OpenStore(env("DEAL_DATA_DIR", ".deal/sessions"))
	if err != nil {
		slog.Error("open DEAL storage", "error", err)
		os.Exit(1)
	}
	defer store.Close()
	mode := env("DEAL_MODEL_MODE", "llm")
	var model deal.Model
	ready := true
	switch mode {
	case "scripted":
		model = deal.ScriptedModel{}
	case "llm":
		retries, _ := llm.Retries(0)
		client := llm.New(llm.Config{APIKey: env("DEAL_LLM_API_KEY", os.Getenv("AURO_LLM_API_KEY")), BaseURL: env("DEAL_LLM_BASE_URL", os.Getenv("AURO_LLM_BASE_URL")), DefaultModel: env("DEAL_LLM_MODEL", os.Getenv("AURO_LLM_DEFAULT_MODEL")), MaxRetries: retries})
		ready = client.Enabled()
		model = deal.LanguageModel{Client: client, Model: client.DefaultModel()}
	default:
		slog.Error("DEAL_MODEL_MODE must be llm or scripted")
		os.Exit(1)
	}
	api := (&deal.HTTP{Service: &deal.Service{Store: store, Model: model, Mode: mode, Ready: ready}, SecureCookies: os.Getenv("DEAL_SECURE_COOKIES") == "true"}).Handler()
	mux := http.NewServeMux()
	mux.Handle("/api/deal/", api)
	assets := env("DEAL_ASSETS_DIR", "../apps/deal/dist")
	fs := http.StripPrefix("/deal/", http.FileServer(http.Dir(filepath.Clean(assets))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/deal" {
			http.Redirect(w, r, "/deal/", http.StatusTemporaryRedirect)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/deal/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
		fs.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: env("DEAL_LISTEN_ADDR", "127.0.0.1:18106"), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("DEAL listening", "address", server.Addr, "mode", mode, "model_ready", ready)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("DEAL server", "error", err)
		os.Exit(1)
	}
}
