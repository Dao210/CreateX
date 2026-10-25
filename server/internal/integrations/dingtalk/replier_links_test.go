package dingtalk

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/auro-ai/auro/server/internal/integrations/channel"
	"github.com/auro-ai/auro/server/internal/integrations/channel/engine"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

func TestIssueMarkdownIdentifierUsesWorkspaceAndStableID(t *testing.T) {
	const id = "11111111-2222-4333-8444-555555555555"
	issueID, err := util.ParseUUID(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, base, slug, key string
		number                int32
		missingID             bool
		want                  string
	}{
		{name: "identifier", base: "https://auro.example/", slug: "team-b", key: "ALHE-6", want: "[ALHE-6](https://auro.example/team-b/issues/" + id + ")"},
		{name: "link label punctuation", base: "https://auro.example", slug: "team-b", key: "A[B]*_`\\-6", want: "[A\\[B\\]\\*\\_\\`\\\\-6](https://auro.example/team-b/issues/" + id + ")"},
		{name: "number uses UUID target", base: "https://auro.example", slug: "team-b", number: 6, want: "[#6](https://auro.example/team-b/issues/" + id + ")"},
		{name: "UUID display fallback", base: "https://auro.example", slug: "team-b", want: "[11111111-2222-4333-8444-555555555555](https://auro.example/team-b/issues/" + id + ")"},
		{name: "local app", base: "http://localhost:3000", slug: "team-b", key: "ALHE-6", want: "[ALHE-6](http://localhost:3000/team-b/issues/" + id + ")"},
		{name: "base path", base: " https://auro.example/apps/auro/ ", slug: "team-b", key: "ALHE-6", want: "[ALHE-6](https://auro.example/apps/auro/team-b/issues/" + id + ")"},
		{name: "parentheses in base path", base: "https://auro.example/apps/(dev)", slug: "team-b", key: "ALHE-6", want: "[ALHE-6](https://auro.example/apps/%28dev%29/team-b/issues/" + id + ")"},
		{name: "missing base", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "invalid base", base: "https://[", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "missing scheme", base: "auro.example", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "unsupported scheme", base: "javascript:alert(1)", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "missing host", base: "https:///app", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "credentials", base: "https://user:secret@auro.example", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "query", base: "https://auro.example?token=private", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "fragment", base: "https://auro.example#other", slug: "team-b", key: "ALHE-6", want: "ALHE-6"},
		{name: "missing workspace", base: "https://auro.example", key: "ALHE-6", want: "ALHE-6"},
		{name: "missing issue ID", base: "https://auro.example", slug: "team-b", key: "ALHE-6", missingID: true, want: "ALHE-6"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := engine.Result{IssueID: issueID, IssueIdentifier: tc.key, IssueWorkspaceSlug: tc.slug, IssueNumber: tc.number}
			if tc.missingID {
				res.IssueID = pgtype.UUID{}
			}
			if got := issueMarkdownIdentifier(res, tc.base); got != tc.want {
				t.Fatalf("identifier = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReplierMissingIssueLinkConfigStillConfirms(t *testing.T) {
	for _, tc := range []struct{ name, appURL, slug string }{
		{"missing app URL", "", "team-b"},
		{"missing result workspace slug", "https://auro.example", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := newDingtalkSendServer(t)
			config, err := json.Marshal(installConfig{AppID: "app", RobotCode: "robot", AppSecretEncrypted: base64.StdEncoding.EncodeToString([]byte("secret"))})
			if err != nil {
				t.Fatal(err)
			}
			inst := engine.ResolvedInstallation{Platform: db.ChannelInstallation{Config: config}}
			r := NewOutboundReplier(OutboundReplierConfig{Client: NewClient(nil, d.srv.URL), AppURL: tc.appURL})
			msg := channel.InboundMessage{Source: channel.Source{ChannelType: TypeDingTalk, ChatType: channel.ChatTypeGroup, ChatID: "conversation"}}
			r.Reply(context.Background(), inst, msg, engine.Result{Outcome: engine.OutcomeIngested, IssueID: pgtype.UUID{Valid: true}, IssueIdentifier: "ALHE-6", IssueTitle: "1+1=?", IssueWorkspaceSlug: tc.slug})
			if len(d.sendBodies) != 1 || d.lastPath != pathSendGroup {
				t.Fatalf("sends=%d path=%q", len(d.sendBodies), d.lastPath)
			}
			var got markdownParam
			if err := json.Unmarshal([]byte(d.lastBody["msgParam"].(string)), &got); err != nil {
				t.Fatal(err)
			}
			if got.Text != "✅ Created ALHE-6 — 1+1=?" {
				t.Fatalf("confirmation = %q", got.Text)
			}
		})
	}
}
