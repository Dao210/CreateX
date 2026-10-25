package main

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/auro-ai/auro/server/internal/reach"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func seed() uint64 {
	if raw := os.Getenv("REACH_SEED"); raw != "" {
		if v, err := strconv.ParseUint(raw, 10, 64); err == nil {
			return v
		}
	}
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return uint64(time.Now().UnixNano())
	}
	return binary.BigEndian.Uint64(buf[:])
}

func main() {
	dataDir := env("REACH_DATA_DIR", ".reach")
	store, err := reach.OpenStore(dataDir)
	if err != nil {
		slog.Error("open REACH storage", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	season := env("REACH_SEASON", reach.SeasonID(time.Now()))
	worldSeed := seed()
	service, err := reach.NewService(store, season, worldSeed)
	if err != nil {
		slog.Error("load REACH world", "error", err)
		os.Exit(1)
	}

	beatSeconds, err := strconv.Atoi(env("REACH_BEAT_SECONDS", "60"))
	if err != nil || beatSeconds <= 0 {
		beatSeconds = 60
	}

	service.BeatSeconds = beatSeconds

	api := &reach.HTTP{
		Service:       service,
		SecureCookies: os.Getenv("REACH_SECURE_COOKIES") == "true",
		SubmitPerHour: 10,
		SnapshotLimit: 600,
	}

	mux := http.NewServeMux()
	// The inner handler owns its own route table; the outer mux only needs to hand
	// everything over so /.well-known and /api/reach share one rate-limit window.
	mux.Handle("/", api.Handler())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		ticker := time.NewTicker(time.Duration(beatSeconds) * time.Second)
		defer ticker.Stop()
		beats := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				service.Advance(1)
				beats++
				if beats%60 == 0 {
					if err := service.Save(); err != nil {
						slog.Error("save REACH world", "error", err)
					}
				}
			}
		}
	}()

	server := &http.Server{
		Addr:              env("REACH_LISTEN_ADDR", "127.0.0.1:18107"),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
		if err := service.Save(); err != nil {
			slog.Error("save REACH world on shutdown", "error", err)
		}
	}()

	slog.Info("REACH listening", "address", server.Addr, "season", service.World.SeasonID, "seed", service.World.Seed, "beatSeconds", beatSeconds)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("REACH server", "error", err)
		os.Exit(1)
	}
}
