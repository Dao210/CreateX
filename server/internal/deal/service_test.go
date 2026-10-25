package deal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/auro-ai/auro/server/pkg/llm"
	"github.com/google/uuid"
)

func testService(t *testing.T) *Service {
	t.Helper()
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return &Service{Store: store, Model: ScriptedModel{}, Mode: "scripted", Ready: true}
}
func input(version int, text string) Input {
	return Input{RequestID: uuid.NewString(), ExpectedVersion: version, Kind: "talk", Text: text}
}
func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var p *Problem
	if !errors.As(err, &p) || p.Code != code {
		t.Fatalf("got %v, want %s", err, code)
	}
}

func TestReceiptsVersionAndRestart(t *testing.T) {
	s := testService(t)
	game, err := s.Create("one")
	if err != nil {
		t.Fatal(err)
	}
	in := input(game.Version, "你为什么替 Victor 工作？")
	first, err := s.Turn(context.Background(), game.ID, "one", in)
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := s.Turn(context.Background(), game.ID, "one", in)
	if err != nil || first.Version != repeat.Version || len(repeat.History) != 1 || repeat.Remaining != 460 {
		t.Fatalf("duplicate changed game: %+v %v", repeat, err)
	}
	changed := in
	changed.Text = "other"
	_, err = s.Turn(context.Background(), game.ID, "one", changed)
	wantCode(t, err, "request_id_reused")
	_, err = s.Turn(context.Background(), game.ID, "one", input(1, "new"))
	wantCode(t, err, "version_conflict")
	_, err = s.Read(game.ID, "another")
	wantCode(t, err, "not_found")
	if _, err = OpenStore(s.Store.dir); err == nil {
		t.Fatal("second writer acquired same directory")
	}
	_ = s.Store.Close()
	reopened, err := OpenStore(s.Store.dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	s.Store = reopened
	restored, err := s.Read(game.ID, "one")
	if err != nil || restored.Version != first.Version || restored.History[0].Dialogue != first.History[0].Dialogue {
		t.Fatal("restart lost committed response")
	}
	_, err = s.Turn(context.Background(), game.ID, "one", in)
	if err != nil {
		t.Fatal("restart lost receipt")
	}
}

type badModel struct {
	ScriptedModel
	failDialogue bool
}

func (m badModel) Interpret(ctx context.Context, text string, v PublicSession) (Interpretation, error) {
	if !m.failDialogue {
		return Interpretation{}, errors.New("upstream failed")
	}
	return m.ScriptedModel.Interpret(ctx, text, v)
}
func (m badModel) ChooseLine(context.Context, string, []Line) (string, error) {
	return "", errors.New("upstream failed")
}
func TestModelFailuresDoNotCommit(t *testing.T) {
	for _, dialogue := range []bool{false, true} {
		t.Run(map[bool]string{false: "extraction", true: "performance"}[dialogue], func(t *testing.T) {
			s := testService(t)
			game, _ := s.Create("one")
			s.Model = badModel{failDialogue: dialogue}
			in := input(1, "你为什么替 Victor 工作？")
			_, err := s.Turn(context.Background(), game.ID, "one", in)
			wantCode(t, err, "model_unavailable")
			view, _ := s.Read(game.ID, "one")
			if view.Version != 1 || view.Remaining != 480 || len(view.History) != 0 {
				t.Fatal("failed model mutated game")
			}
			s.Model = ScriptedModel{}
			if _, err = s.Turn(context.Background(), game.ID, "one", in); err != nil {
				t.Fatal("same request could not retry")
			}
		})
	}
}

func TestConcurrentSameRequestCommitsOnce(t *testing.T) {
	s := testService(t)
	game, _ := s.Create("one")
	in := input(1, "请继续")
	var group sync.WaitGroup
	for range 5 {
		group.Go(func() {
			if _, err := s.Turn(context.Background(), game.ID, "one", in); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	view, _ := s.Read(game.ID, "one")
	if view.Version != 2 || len(view.History) != 1 || view.Remaining != 460 {
		t.Fatal("concurrent request applied multiple times")
	}
}

func TestHTTPIdentityOriginsAndMalformedRequests(t *testing.T) {
	h := (&HTTP{Service: testService(t)}).Handler()
	call := func(method, path, body, origin string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://game.local"+path, bytes.NewBufferString(body))
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call("POST", "/api/deal/sessions", "{}", "http://evil.local", nil); w.Code != 403 {
		t.Fatal("cross-origin create accepted")
	}
	if w := call("POST", "/api/deal/sessions", "{}", "https://game.local", nil); w.Code != 403 {
		t.Fatal("cross-scheme create accepted")
	}
	w := call("POST", "/api/deal/sessions", "{}", "http://game.local", nil)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var view PublicSession
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/api/deal" {
		t.Fatal("owner cookie is not isolated")
	}
	if w = call("GET", "/api/deal/sessions/"+view.ID, "", "", nil); w.Code != 404 {
		t.Fatal("unowned session leaked")
	}
	if w = call("GET", "/api/deal/sessions/"+view.ID, "", "", cookie); w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("owned read failed")
	}
	if w = call("POST", "/api/deal/sessions/"+view.ID+"/turns", `{"request_id":"invalid","expected_version":1,"kind":"talk","text":"hi"}`, "", cookie); w.Code != 400 {
		t.Fatal("invalid input accepted")
	}
	if w = call("POST", "/api/deal/sessions", `{} {}`, "", cookie); w.Code != 400 {
		t.Fatal("trailing JSON accepted")
	}
}

func TestHTTPSProxyOriginAndSecureCookie(t *testing.T) {
	h := (&HTTP{Service: testService(t), SecureCookies: true}).Handler()
	for _, origin := range []string{"http://game.local", "https://game.local"} {
		r := httptest.NewRequest("POST", "http://game.local/api/deal/sessions", bytes.NewBufferString("{}"))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if origin == "http://game.local" {
			if w.Code != 403 {
				t.Fatal("HTTPS deployment accepted HTTP origin")
			}
		} else if w.Code != 201 || !w.Result().Cookies()[0].Secure {
			t.Fatal("HTTPS proxy did not issue a secure owner cookie")
		}
	}
}

func TestLanguageModelSDKContractAndGrounding(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		encoded, _ := json.Marshal(body)
		if bytes.Contains(encoded, []byte("owner_hash")) || bytes.Contains(encoded, []byte("psychology")) || bytes.Contains(encoded, []byte("42,000")) {
			t.Error("private state sent upstream")
		}
		content := `{"act":"probe","topic":"victor","proposal":"none","days":0,"claims":[]}`
		if calls == 2 {
			content = `{"line_id":"a"}`
		}
		respond(w, 200, map[string]any{"id": "test", "object": "chat.completion", "model": "fake", "choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": content}, "finish_reason": "stop"}}})
	}))
	defer upstream.Close()
	retries, _ := llm.Retries(0)
	m := LanguageModel{Client: llm.New(llm.Config{APIKey: "test", BaseURL: upstream.URL, DefaultModel: "fake", MaxRetries: retries}), Model: "fake"}
	view := NewSession(uuid.NewString(), "secret").Public()
	parsed, err := m.Interpret(context.Background(), "Victor 为什么派你来？", view)
	if err != nil || parsed.Topic != "victor" {
		t.Fatalf("extract: %v", err)
	}
	text, err := m.ChooseLine(context.Background(), "test", []Line{{ID: "a", Text: "authorized"}})
	if err != nil || text != "authorized" || calls != 2 {
		t.Fatalf("performance: %q %v", text, err)
	}
	bad := Interpretation{Act: "assert", Topic: "money", Proposal: "none", Claims: []Assertion{{Key: "cash", Value: "has", Scope: "now", Quote: "not in original"}}}
	if validateInterpretation(bad, "I have no money") == nil {
		t.Fatal("hallucinated quote accepted")
	}
	if decodeStrict(`{"act":"assert","effects":{"trust":100}}`, &Interpretation{}) == nil {
		t.Fatal("world-writing field accepted")
	}
}
