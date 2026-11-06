package main

import (
	"context"
	"fmt"
	"github.com/auro-ai/auro/server/pkg/llm"
	"os"
	"strconv"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/life"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newLifeService(pool *pgxpool.Pool, bus *events.Bus) (*life.Service, error) {
	path := os.Getenv("AGENT_LIFE_ENGINE_PATH")
	if path == "" {
		path = life.DefaultEnginePath()
	}
	engine := life.NewNodeRuntime(path)
	service := life.NewService(&life.Repository{Pool: pool}, engine, bus)
	mode := os.Getenv("AGENT_LIFE_MODEL_MODE")
	if mode == "" {
		mode = "rules"
	}
	if mode != "rules" && mode != "llm" {
		return nil, fmt.Errorf("invalid AGENT_LIFE_MODEL_MODE")
	}
	service.Coordinator.Mode = mode
	for _, entry := range []struct {
		key    string
		target *int
		max    int
	}{{"AGENT_LIFE_MODEL_RESIDENTS", &service.Coordinator.ResidentLimit, 60}, {"AGENT_LIFE_MODEL_DAILY_LIMIT", &service.Coordinator.DailyLimit, 1000}} {
		if raw := os.Getenv(entry.key); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > entry.max {
				return nil, fmt.Errorf("invalid %s", entry.key)
			}
			*entry.target = n
		}
	}
	retries, err := parseLLMMaxRetries(os.Getenv("AURO_LLM_MAX_RETRIES"))
	if err != nil {
		return nil, err
	}
	thinking, err := parseLLMDisableThinking(os.Getenv("AURO_LLM_DISABLE_THINKING"))
	if err != nil {
		return nil, err
	}
	service.Coordinator.Client = llm.New(llm.Config{APIKey: os.Getenv("AURO_LLM_API_KEY"), BaseURL: os.Getenv("AURO_LLM_BASE_URL"), DefaultModel: os.Getenv("AURO_LLM_DEFAULT_MODEL"), MaxRetries: retries, DisableThinking: thinking})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := service.Prepare(ctx, os.Getenv("AGENT_LIFE_WORKSPACE_ID")); err != nil {
		_ = engine.Close()
		return nil, err
	}
	return service, nil
}
