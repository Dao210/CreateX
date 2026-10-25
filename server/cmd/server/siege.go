package main

import (
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/auro-ai/auro/server/internal/siege"
	"github.com/auro-ai/auro/server/pkg/llm"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newSiegeService wires the drawing workshop onto the main server's database.
//
// Recognition is opt-in. With no SIEGE_RECOGNITION_MODE the service still
// serves saved blueprints and manual part labelling, and reports
// status.ready=false so the client hides the AI button. A missing or broken
// model configuration must never keep Auro from starting: the game is a
// feature, not a startup dependency.
func newSiegeService(pool *pgxpool.Pool) *siege.Service {
	mode := strings.TrimSpace(os.Getenv("SIEGE_RECOGNITION_MODE"))
	budget := 100
	if raw := os.Getenv("SIEGE_DAILY_RECOGNITION_LIMIT"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 10000 {
			budget = parsed
		}
	}
	var recognizer siege.Recognizer
	ready := false
	switch mode {
	case "fixture":
		// Fixture recognition only knows the two shipped samples. Useful for
		// e2e and demos; log loudly because it should not be a production mode.
		slog.Warn("siege: fixture recognition enabled")
		recognizer = siege.FixtureRecognizer{}
		ready = true
	case "llm":
		retries, _ := llm.Retries(0)
		model := strings.TrimSpace(os.Getenv("SIEGE_LLM_MODEL"))
		client := llm.New(llm.Config{
			APIKey:       os.Getenv("SIEGE_LLM_API_KEY"),
			BaseURL:      os.Getenv("SIEGE_LLM_BASE_URL"),
			DefaultModel: model,
			MaxRetries:   retries,
		})
		if client.Enabled() && model != "" {
			recognizer = siege.VisionRecognizer{Client: client, Model: model}
			ready = true
		} else {
			slog.Warn("siege: recognition requested but the model is not configured; manual labelling only")
			mode = ""
		}
	default:
		mode = ""
	}
	if mode == "" {
		mode = "disabled"
	}
	return siege.NewService(siege.OpenPGStore(pool), recognizer, mode, ready, budget)
}
