package gameprogress

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeStore struct {
	rows map[string]Stored
}

func (s *fakeStore) Load(context.Context, string, string) (map[string]Stored, error) {
	return s.rows, nil
}

func (s *fakeStore) Merge(_ context.Context, _, _, game string, merge func([]byte) ([]byte, error)) (Stored, error) {
	current := s.rows[game].Payload
	payload, err := merge(current)
	if err != nil {
		return Stored{}, err
	}
	stored := Stored{Payload: payload, UpdatedAt: time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)}
	s.rows[game] = stored
	return stored, nil
}

func request(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r = r.WithContext(WithActor(r.Context(), Actor{WorkspaceID: "workspace", UserID: "user"}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestMergeIsMonotonic(t *testing.T) {
	siege, err := mergeSiege(nil, SiegeProgress{Stars: []int{3, 0, 0, 0, 0, 0, 0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	siege, err = mergeSiege(siege, SiegeProgress{Stars: []int{1, 2, 0, 0, 0, 0, 0, 0}})
	if err != nil {
		t.Fatal(err)
	}
	var stars SiegeProgress
	if err = json.Unmarshal(siege, &stars); err != nil {
		t.Fatal(err)
	}
	if stars.Stars[0] != 3 || stars.Stars[1] != 2 {
		t.Fatalf("siege=%+v", stars)
	}
	tanks, err := mergeTanks(nil, TankProgress{Best: 900, Unlocked: 3})
	if err != nil {
		t.Fatal(err)
	}
	tanks, err = mergeTanks(tanks, TankProgress{Best: 100, Unlocked: 2})
	if err != nil {
		t.Fatal(err)
	}
	var progress TankProgress
	if err = json.Unmarshal(tanks, &progress); err != nil {
		t.Fatal(err)
	}
	if progress.Best != 900 || progress.Unlocked != 3 {
		t.Fatalf("tanks=%+v", progress)
	}
}

func TestHTTPRejectsInvalidInputAndReturnsMergedProgress(t *testing.T) {
	store := &fakeStore{rows: map[string]Stored{}}
	h := (&HTTP{Store: store}).Handler()

	if w := request(t, h, http.MethodPut, "/api/game-progress/siege", `{"stars":[1,2]}`); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid siege status=%d body=%s", w.Code, w.Body.String())
	}
	if w := request(t, h, http.MethodPut, "/api/game-progress/tanks", `{"best":-1,"unlocked":1}`); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid tank status=%d body=%s", w.Code, w.Body.String())
	}
	if w := request(t, h, http.MethodPut, "/api/game-progress/other", `{}`); w.Code != http.StatusNotFound {
		t.Fatalf("unknown game status=%d", w.Code)
	}

	w := request(t, h, http.MethodPut, "/api/game-progress/siege", `{"stars":[3,0,0,0,0,0,0,0]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("save siege status=%d body=%s", w.Code, w.Body.String())
	}
	var saved struct {
		WorkspaceID string `json:"workspaceId"`
		Stars       []int  `json:"stars"`
		UpdatedAt   string `json:"updatedAt"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.WorkspaceID != "workspace" || saved.Stars[0] != 3 || saved.UpdatedAt == "" {
		t.Fatalf("saved=%+v", saved)
	}

	w = request(t, h, http.MethodGet, "/api/game-progress", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get status=%d body=%s", w.Code, w.Body.String())
	}
	var overview struct {
		WorkspaceID string     `json:"workspaceId"`
		Siege       *siegeView `json:"siege"`
		Tanks       *tankView  `json:"tanks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &overview); err != nil {
		t.Fatal(err)
	}
	if overview.WorkspaceID != "workspace" || overview.Siege == nil || overview.Siege.Stars[0] != 3 || overview.Tanks != nil {
		t.Fatalf("overview=%+v", overview)
	}
}

func TestHTTPRequiresAnActor(t *testing.T) {
	h := (&HTTP{Store: &fakeStore{rows: map[string]Stored{}}}).Handler()
	r := httptest.NewRequest(http.MethodGet, "/api/game-progress", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestHTTPRejectsUnknownFieldsAndWrongContentType(t *testing.T) {
	h := (&HTTP{Store: &fakeStore{rows: map[string]Stored{}}}).Handler()
	if w := request(t, h, http.MethodPut, "/api/game-progress/tanks", `{"best":1,"unlocked":1,"extra":true}`); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", w.Code)
	}
	r := httptest.NewRequest(http.MethodPut, "/api/game-progress/tanks", strings.NewReader(`{"best":1,"unlocked":1}`))
	r = r.WithContext(WithActor(r.Context(), Actor{WorkspaceID: "workspace", UserID: "user"}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("content type status=%d", w.Code)
	}
}
