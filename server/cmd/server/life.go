package main

import (
	"context"
	"os"
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
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := service.Prepare(ctx, os.Getenv("AGENT_LIFE_WORKSPACE_ID")); err != nil {
		_ = engine.Close()
		return nil, err
	}
	return service, nil
}
