package slack

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/slack-go/slack"

	"github.com/auro-ai/auro/server/internal/integrations/channel/engine"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

// ---- fakes ----

type fakeSlashQueries struct {
	inst      db.ChannelInstallation
	instErr   error
	binding   db.ChannelUserBinding
	bindErr   error
	memberErr error
	gotAppID  string
}

func (f *fakeSlashQueries) GetChannelInstallationByAppID(_ context.Context, arg db.GetChannelInstallationByAppIDParams) (db.ChannelInstallation, error) {
	f.gotAppID = arg.AppID
	return f.inst, f.instErr
}

func (f *fakeSlashQueries) GetChannelUserBindingByUserID(_ context.Context, _ db.GetChannelUserBindingByUserIDParams) (db.ChannelUserBinding, error) {
	return f.binding, f.bindErr
}

func (f *fakeSlashQueries) GetMemberByUserAndWorkspace(_ context.Context, _ db.GetMemberByUserAndWorkspaceParams) (db.Member, error) {
	return db.Member{}, f.memberErr
}

// fakeQuickCreate records the last EnqueueQuickCreateTask call so tests can
// assert the prompt is passed through verbatim and attributed correctly.
type fakeQuickCreate struct {
	task  db.AgentTaskQueue
	err   error
	calls int

	workspaceID pgtype.UUID
	requesterID pgtype.UUID
	agentID     pgtype.UUID
	squadID     pgtype.UUID
	prompt      string
}

type fakeSlashControlStarter struct {
	newCalls   int
	clearCalls int
	envelopeID string
	cmd        slack.SlashCommand
	err        error
}

func (f *fakeSlashControlStarter) StartSlackDMChat(_ context.Context, _ engine.ResolvedInstallation, _ pgtype.UUID, cmd slack.SlashCommand, envelopeID string) error {
	f.newCalls++
	f.cmd = cmd
	f.envelopeID = envelopeID
	return f.err
}

func (f *fakeSlashControlStarter) ClearSlackDMContext(_ context.Context, _ engine.ResolvedInstallation, _ pgtype.UUID, cmd slack.SlashCommand, envelopeID string) error {
	f.clearCalls++
	f.cmd = cmd
	f.envelopeID = envelopeID
	return f.err
}

func slashTestUUID(b byte) pgtype.UUID {
	var u pgtype.UUID
	for i := range u.Bytes {
		u.Bytes[i] = b
	}
	u.Valid = true
	return u
}

func activeSlashInstallation() db.ChannelInstallation {
	return db.ChannelInstallation{
		ID:              slashTestUUID(1),
		WorkspaceID:     slashTestUUID(2),
		AgentID:         slashTestUUID(3),
		InstallerUserID: slashTestUUID(4),
		Status:          "active",
		Config:          []byte(`{"app_id":"A1","team_id":"T1"}`),
	}
}

// ---- tests ----
