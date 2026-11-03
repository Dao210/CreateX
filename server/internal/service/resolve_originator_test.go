package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/auro-ai/auro/server/internal/featureflags"
	"github.com/auro-ai/auro/server/internal/runtimeapps"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/featureflag"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newResolveOriginatorPool returns the package's shared test pool; see
// sharedTestPool.
func newResolveOriginatorPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return sharedTestPool(t)
}

type stubOverlayBuilder struct {
	calls     int
	lastUser  pgtype.UUID
	lastAgent db.Agent
	resp      json.RawMessage
	apps      []runtimeapps.ConnectedApp
	err       error
	respIsNil bool
}

func (s *stubOverlayBuilder) BuildTaskOverlay(_ context.Context, originatorUserID pgtype.UUID, agent db.Agent) (runtimeapps.MCPOverlayResult, error) {
	s.calls++
	s.lastUser = originatorUserID
	s.lastAgent = agent
	if s.err != nil {
		return runtimeapps.MCPOverlayResult{}, s.err
	}
	if s.respIsNil {
		return runtimeapps.MCPOverlayResult{}, nil
	}
	return runtimeapps.MCPOverlayResult{MCPOverlay: s.resp, ConnectedApps: s.apps}, nil
}

func composioMCPAppsTestFlags(enabled bool) *featureflag.Service {
	provider := featureflag.NewStaticProvider()
	provider.Set(featureflags.ComposioMCPApps, featureflag.Rule{Default: enabled})
	return featureflag.NewService(provider)
}

func TestBuildRuntimeMCPOverlaySkipsBuilderWhenComposioFlagDisabled(t *testing.T) {
	builder := &stubOverlayBuilder{
		resp: json.RawMessage(`{"mcpServers":{"composio":{"type":"http","url":"https://mcp.example/session"}}}`),
		apps: []runtimeapps.ConnectedApp{{
			Provider:    "composio",
			ServerName:  "composio",
			ToolkitSlug: "notion",
			ToolkitName: "Notion",
		}},
	}
	svc := &TaskService{
		Composio:     builder,
		FeatureFlags: composioMCPAppsTestFlags(false),
	}
	var userBytes [16]byte
	userBytes[15] = 1
	var agentBytes [16]byte
	agentBytes[15] = 2
	got := svc.buildRuntimeMCPOverlay(context.Background(), pgtype.UUID{Bytes: userBytes, Valid: true}, db.Agent{
		ID: pgtype.UUID{Bytes: agentBytes, Valid: true},
	})
	if builder.calls != 0 {
		t.Fatalf("BuildTaskOverlay calls = %d, want 0", builder.calls)
	}
	if len(got.Overlay) != 0 || len(got.ConnectedApps) != 0 {
		t.Fatalf("flag-off overlay = %+v; want empty", got)
	}
}
