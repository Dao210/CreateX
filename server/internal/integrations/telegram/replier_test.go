package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/auro-ai/auro/server/internal/integrations/channel"
	"github.com/auro-ai/auro/server/internal/integrations/channel/engine"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

type fakeTelegramBindingMinter struct {
	calls int
	raw   string
}

func (f *fakeTelegramBindingMinter) Mint(context.Context, pgtype.UUID, pgtype.UUID, string) (BindingToken, error) {
	f.calls++
	return BindingToken{Raw: f.raw}, nil
}

func TestReplyNeedsBindingDoesNotMintBearerLinkInGroup(t *testing.T) {
	var got sendMessageParams
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":{"message_id":1,"chat":{"id":42,"type":"group"}}}`))
	}))
	defer srv.Close()

	minter := &fakeTelegramBindingMinter{raw: "secret-token"}
	r := NewOutboundReplier(OutboundReplierConfig{
		Binding:    minter,
		Decrypt:    nil,
		AppURL:     "https://auro.example",
		APIBase:    srv.URL,
		HTTPClient: srv.Client(),
		Logger:     testLogger(),
	})
	inst := engine.ResolvedInstallation{
		ID:          telegramTestUUID(1),
		WorkspaceID: telegramTestUUID(2),
		Platform:    db.ChannelInstallation{Config: []byte(`{"bot_token_encrypted":"MTIzOnNlY3JldA=="}`)},
	}
	msg := channel.InboundMessage{Source: channel.Source{
		ChatID: "42", ChatType: channel.ChatTypeGroup, SenderID: "telegram-user",
	}}

	r.Reply(context.Background(), inst, msg, engine.Result{
		Outcome: engine.OutcomeNeedsBinding,
		Sender:  "telegram-user",
	})

	if minter.calls != 0 {
		t.Fatalf("Mint called %d times for a group prompt", minter.calls)
	}
	if !strings.Contains(got.Text, msgBindingGroupHint) {
		t.Fatalf("group prompt = %q, want %q", got.Text, msgBindingGroupHint)
	}
	if strings.Contains(got.Text, "secret-token") || strings.Contains(got.Text, "auro.example") {
		t.Fatalf("group prompt exposed a redeem link: %q", got.Text)
	}
}

func TestReplyNeedsBindingInPrivateChatMintsQuotedLink(t *testing.T) {
	var got sendMessageParams
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":{"message_id":1,"chat":{"id":42,"type":"private"}}`))
	}))
	defer srv.Close()

	minter := &fakeTelegramBindingMinter{raw: "one-time-token"}
	r := NewOutboundReplier(OutboundReplierConfig{
		Binding: minter, AppURL: "https://auro.example/", APIBase: srv.URL,
		HTTPClient: srv.Client(), Logger: testLogger(),
	})
	inst := engine.ResolvedInstallation{
		ID: telegramTestUUID(1), WorkspaceID: telegramTestUUID(2),
		Platform: db.ChannelInstallation{Config: []byte(`{"bot_token_encrypted":"MTIzOnNlY3JldA=="}`)},
	}
	msg := channel.InboundMessage{
		MessageID: "42:7",
		Source:    channel.Source{ChatID: "42", ChatType: channel.ChatTypeP2P, SenderID: "telegram-user"},
	}
	r.Reply(context.Background(), inst, msg, engine.Result{Outcome: engine.OutcomeNeedsBinding})

	if minter.calls != 1 || !strings.Contains(got.Text, "https://auro.example/telegram/bind?token=one-time-token") {
		t.Fatalf("binding prompt = %+v; mint calls = %d", got, minter.calls)
	}
	if got.ReplyParameters == nil || got.ReplyParameters.MessageID != 7 || !got.ReplyParameters.AllowSendingWithoutReply {
		t.Fatalf("binding prompt lost reply context: %+v", got)
	}
}
