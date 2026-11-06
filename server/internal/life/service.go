package life

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/auro-ai/auro/server/internal/events"
	"github.com/auro-ai/auro/server/internal/util"
	"github.com/auro-ai/auro/server/pkg/protocol"
	"github.com/jackc/pgx/v5"
)

type Status struct {
	State string
	Tick  int64
}
type Service struct {
	Repository  *Repository
	Engine      Engine
	Bus         *events.Bus
	Coordinator *Coordinator
	status      atomic.Pointer[Status]
	done        chan struct{}
}

func NewService(repository *Repository, engine Engine, bus *events.Bus) *Service {
	s := &Service{Repository: repository, Engine: engine, Bus: bus, done: make(chan struct{})}
	s.Coordinator = &Coordinator{Repository: repository, Mode: "rules", ResidentLimit: 5, DailyLimit: 100, Notify: s.notify}
	return s
}
func (s *Service) Status() Status {
	if status := s.status.Load(); status != nil {
		return *status
	}
	return Status{State: "starting"}
}
func (s *Service) setStatus(state string, tick int64) {
	s.status.Store(&Status{State: state, Tick: tick})
}

// Prepare is called once before serving. Existing state is never reseeded.
func (s *Service) Prepare(ctx context.Context, bootstrapWorkspace string) error {
	if err := s.Repository.CheckWriterCutover(ctx); err != nil {
		return err
	}
	binding, err := s.Repository.Binding(ctx)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil && bootstrapWorkspace != "" {
		requested, e := util.ParseUUID(bootstrapWorkspace)
		if e != nil {
			return e
		}
		if requested != binding.WorkspaceID {
			return ErrBindingMismatch
		}
	}
	if errors.Is(err, pgx.ErrNoRows) && bootstrapWorkspace == "" {
		s.setStatus("uninitialized", 0)
		return nil
	}
	seed, err := s.Engine.Seed(ctx)
	if err != nil {
		return err
	}
	if !binding.ID.Valid {
		binding, err = s.Repository.Initialize(ctx, bootstrapWorkspace, seed)
		if err != nil {
			return err
		}
	}
	s.setStatus("running", binding.Tick)
	return nil
}

func (s *Service) Step(ctx context.Context) (bool, error) {
	binding, err := s.Repository.Binding(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		s.setStatus("uninitialized", 0)
		return false, nil
	}
	if err != nil {
		return false, err
	}
	due, err := s.Repository.Due(ctx, binding)
	if err != nil {
		return false, err
	}
	if !due {
		return false, nil
	}
	before, err := s.Repository.Load(ctx, binding)
	if err != nil {
		return false, err
	}
	result, err := s.Engine.Advance(ctx, before)
	if err != nil {
		return false, err
	}
	if err = s.Repository.Commit(ctx, binding, before, result); errors.Is(err, ErrStaleTick) {
		// Losing a version race to another API replica is a healthy compute attempt.
		s.setStatus("running", before.Tick)
		return false, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		s.setStatus("uninitialized", 0)
		return false, nil
	}
	if err != nil {
		return false, err
	}
	s.setStatus("running", result.State.Tick)
	if s.Bus != nil {
		s.Bus.Publish(events.Event{Type: protocol.EventLifeUpdated, WorkspaceID: util.UUIDToString(binding.WorkspaceID), ActorType: "system", Payload: map[string]any{"world_id": util.UUIDToString(binding.ID), "workspace_id": util.UUIDToString(binding.WorkspaceID), "tick": result.State.Tick}})
	}
	return true, nil
}

func (s *Service) Run(ctx context.Context) {
	defer close(s.done)
	defer s.Engine.Close()
	if s.Coordinator != nil {
		stopped := make(chan struct{})
		go func() { defer close(stopped); s.Coordinator.Run(ctx) }()
		defer func() { <-stopped }()
	}
	defer func() { s.setStatus("stopped", s.Status().Tick) }()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_, err := s.Step(callCtx)
		cancel()
		if err != nil && ctx.Err() == nil {
			s.setStatus("error", s.Status().Tick)
			slog.Error("life tick failed; committed state retained", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Service) Wait(ctx context.Context) error {
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) notify(workspace string) {
	if s.Bus != nil {
		s.Bus.Publish(events.Event{Type: protocol.EventLifeUpdated, WorkspaceID: workspace, ActorType: "system", Payload: map[string]any{"workspace_id": workspace}})
	}
}
