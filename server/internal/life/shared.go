package life

import (
	"context"
	"errors"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// A route workspace identifies the viewer's membership, never a separate simulation.
func (s *Service) ensureSharedWorld(ctx context.Context, workspace pgtype.UUID) error {
	if _, err := s.Repository.Binding(ctx); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	seed, err := s.Engine.Seed(ctx)
	if err != nil {
		return err
	}
	_, err = s.Repository.Initialize(ctx, util.UUIDToString(workspace), seed)
	return err
}

func (s *Service) GetLifeSnapshot(ctx context.Context, workspace pgtype.UUID) ([]byte, error) {
	if err := s.ensureSharedWorld(ctx, workspace); err != nil {
		return nil, err
	}
	return db.New(s.Repository.Pool).GetLifeSnapshot(ctx, workspace)
}

func (s *Service) GetLifeHistory(ctx context.Context, params db.GetLifeHistoryParams) ([]byte, error) {
	if err := s.ensureSharedWorld(ctx, params.WorkspaceID); err != nil {
		return nil, err
	}
	return db.New(s.Repository.Pool).GetLifeHistory(ctx, params)
}

func (s *Service) Command(ctx context.Context, workspace, user string, command TownCommand, modelReady bool) (CommandResult, error) {
	if err := validateCommand(command); err != nil {
		return CommandResult{}, err
	}
	id, err := util.ParseUUID(workspace)
	if err != nil {
		return CommandResult{}, townError("invalid_workspace", 400)
	}
	if err = s.ensureSharedWorld(ctx, id); err != nil {
		return CommandResult{}, err
	}
	return s.Repository.Command(ctx, workspace, user, command, modelReady)
}
