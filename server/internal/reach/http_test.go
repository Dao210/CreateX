package reach

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testHandler(t *testing.T) (*HTTP, *Service) {
	t.Helper()
	svc, err := NewService(nil, "2026-S04", 42)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return &HTTP{Service: svc, SubmitPerHour: 1000}, svc
}

func do(t *testing.T, h http.Handler, method, path, body string, headers map[string]string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func specJSON(t *testing.T) string {
	t.Helper()
	data, err := json.Marshal(validCharacter())
	if err != nil {
		t.Fatalf("marshal spec: %v", err)
	}
	return string(data)
}

func TestWellKnownIsSelfDescribing(t *testing.T) {
	api, _ := testHandler(t)
	rec := do(t, api.Handler(), http.MethodGet, "/.well-known/reach.json", "", nil, nil)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	for _, key := range []string{"world", "season", "schemas", "endpoints", "limits"} {
		if _, ok := body[key]; !ok {
			t.Fatalf("well-known missing %q", key)
		}
	}
	if body["world"] != "reach" {
		t.Fatalf("unexpected world name: %v", body["world"])
	}
}

func TestSchemaEndpoint(t *testing.T) {
	api, _ := testHandler(t)
	rec := do(t, api.Handler(), http.MethodGet, "/api/reach/schema/entity-1.json", "", nil, nil)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var schema map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &schema); err != nil {
		t.Fatalf("schema is not json: %v", err)
	}
	if schema["$schema"] == nil || schema["properties"] == nil {
		t.Fatal("schema must be a usable JSON Schema document")
	}
}

func TestSubmitAcceptsAndIssuesCookie(t *testing.T) {
	api, svc := testHandler(t)
	rec := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), map[string]string{
		"Idempotency-Key": "key-00000001",
	}, nil)
	if rec.Code != 201 {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var receipt Receipt
	if err := json.Unmarshal(rec.Body.Bytes(), &receipt); err != nil {
		t.Fatalf("receipt: %v", err)
	}
	if receipt.EntityID == "" || receipt.Normalized.Geometry.Hash == "" {
		t.Fatalf("receipt incomplete: %+v", receipt)
	}
	if receipt.Diagnostics.PowerIndex < 0 || receipt.Diagnostics.PowerIndex > 100 {
		t.Fatalf("powerIndex out of range: %d", receipt.Diagnostics.PowerIndex)
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("anonymous submit must issue an owner cookie")
	}
	if len(svc.World.Entities) != 1 {
		t.Fatalf("expected one entity, got %d", len(svc.World.Entities))
	}
}

func TestSubmitIsIdempotent(t *testing.T) {
	api, svc := testHandler(t)
	headers := map[string]string{"Idempotency-Key": "key-aaaaaaaa"}
	first := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), headers, nil)
	second := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), headers, nil)

	var a, b Receipt
	json.Unmarshal(first.Body.Bytes(), &a)
	json.Unmarshal(second.Body.Bytes(), &b)
	if a.EntityID != b.EntityID {
		t.Fatalf("same key must return the same entity: %s vs %s", a.EntityID, b.EntityID)
	}
	if len(svc.World.Entities) != 1 {
		t.Fatalf("idempotent submit must not duplicate: %d", len(svc.World.Entities))
	}
}

func TestDuplicateSpecIsReported(t *testing.T) {
	api, svc := testHandler(t)
	first := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), map[string]string{"Idempotency-Key": "key-bbbbbbbb"}, nil)
	second := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), map[string]string{"Idempotency-Key": "key-cccccccc"}, nil)

	var a, b Receipt
	json.Unmarshal(first.Body.Bytes(), &a)
	json.Unmarshal(second.Body.Bytes(), &b)
	if a.EntityID != b.EntityID {
		t.Fatal("the same spec must not enter twice")
	}
	if len(b.Diagnostics.Notes) == 0 {
		t.Fatal("a duplicate must explain itself")
	}
	if len(svc.World.Entities) != 1 {
		t.Fatalf("expected one entity, got %d", len(svc.World.Entities))
	}
}

func TestInvalidEntityReturnsFields(t *testing.T) {
	api, svc := testHandler(t)
	spec := validCharacter()
	spec.Stats = Stats{Atk: 40, Tough: 40, Agi: 40, Sense: 40, Upkeep: 40}
	data, _ := json.Marshal(spec)

	rec := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", string(data), map[string]string{
		"Idempotency-Key": "key-dddddddd",
	}, nil)
	if rec.Code != 422 {
		t.Fatalf("expected 422, got %d", rec.Code)
	}
	var body struct {
		Code   string       `json:"code"`
		Fields []FieldError `json:"fields"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	if body.Code != "invalid_entity" || len(body.Fields) == 0 {
		t.Fatalf("expected field diagnostics, got %+v", body)
	}
	if len(svc.World.Entities) != 0 {
		t.Fatal("invalid submission must not enter the world")
	}
}

func TestUnknownFieldIsRejected(t *testing.T) {
	api, _ := testHandler(t)
	body := strings.Replace(specJSON(t), `"schema"`, `"script":"rm -rf /","schema"`, 1)
	rec := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", body, map[string]string{
		"Idempotency-Key": "key-eeeeeeee",
	}, nil)
	if rec.Code != 400 {
		t.Fatalf("unknown fields must be rejected, got %d", rec.Code)
	}
}

func TestStateSupportsEtag(t *testing.T) {
	api, _ := testHandler(t)
	first := do(t, api.Handler(), http.MethodGet, "/api/reach/state", "", nil, nil)
	if first.Code != 200 {
		t.Fatalf("status %d", first.Code)
	}
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("state must be cacheable by version")
	}
	second := do(t, api.Handler(), http.MethodGet, "/api/reach/state", "", map[string]string{"If-None-Match": etag}, nil)
	if second.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", second.Code)
	}
}

func TestFeedReturnsCursor(t *testing.T) {
	api, svc := testHandler(t)
	svc.Advance(300)
	rec := do(t, api.Handler(), http.MethodGet, "/api/reach/feed?since=0&limit=10", "", nil, nil)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		Cursor int64       `json:"cursor"`
		Events []Chronicle `json:"events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	if len(body.Events) > 10 {
		t.Fatalf("limit not respected: %d", len(body.Events))
	}
}

func TestOrderRequiresOwnership(t *testing.T) {
	api, _ := testHandler(t)
	rec := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), map[string]string{
		"Idempotency-Key": "key-ffffffff",
	}, nil)
	cookies := rec.Result().Cookies()
	var receipt Receipt
	json.Unmarshal(rec.Body.Bytes(), &receipt)

	anonymous := do(t, api.Handler(), http.MethodPost, "/api/reach/entities/"+receipt.EntityID+"/orders", `{"kind":"hold"}`, nil, nil)
	if anonymous.Code != 403 {
		t.Fatalf("anonymous order must be forbidden, got %d", anonymous.Code)
	}

	owner := do(t, api.Handler(), http.MethodPost, "/api/reach/entities/"+receipt.EntityID+"/orders", `{"kind":"hold"}`, nil, cookies)
	if owner.Code != 200 {
		t.Fatalf("owner order should pass, got %d: %s", owner.Code, owner.Body.String())
	}

	bad := do(t, api.Handler(), http.MethodPost, "/api/reach/entities/"+receipt.EntityID+"/orders", `{"kind":"teleport"}`, nil, cookies)
	if bad.Code != 400 {
		t.Fatalf("unknown order must be rejected, got %d", bad.Code)
	}
}

func TestProfileHidesInternals(t *testing.T) {
	api, _ := testHandler(t)
	rec := do(t, api.Handler(), http.MethodPost, "/api/reach/entities", specJSON(t), map[string]string{
		"Idempotency-Key": "key-11111111",
	}, nil)
	var receipt Receipt
	json.Unmarshal(rec.Body.Bytes(), &receipt)

	profile := do(t, api.Handler(), http.MethodGet, "/api/reach/entities/"+receipt.EntityID, "", nil, nil)
	if profile.Code != 200 {
		t.Fatalf("status %d", profile.Code)
	}
	var raw map[string]any
	json.Unmarshal(profile.Body.Bytes(), &raw)
	for _, forbidden := range []string{"charge", "orderUntil", "ownerHash", "hp", "x", "y"} {
		if _, ok := raw[forbidden]; ok {
			t.Fatalf("profile must not expose %q", forbidden)
		}
	}
	if raw["name"] != "Rust Marshal" {
		t.Fatalf("unexpected profile: %+v", raw)
	}
}
