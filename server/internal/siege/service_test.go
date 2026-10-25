package siege

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

type countedModel struct {
	Calls atomic.Int32
	Fail  bool
}

func (m *countedModel) Recognize(ctx context.Context, d Drawing) (Spec, int64, int64, error) {
	m.Calls.Add(1)
	if m.Fail {
		return Spec{}, 0, 0, errors.New("upstream outcome unknown")
	}
	return (FixtureRecognizer{}).Recognize(ctx, d)
}
func setup(t *testing.T, model Recognizer) (*Service, string, Owner) {
	t.Helper()
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	service := NewService(store, model, "fixture", true, 100)
	owner := Owner{UserID: "test-owner"}
	session, err := service.Create(owner, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	return service, session.ID, owner
}
func TestRecognitionReceiptAndBlueprintIdempotency(t *testing.T) {
	model := &countedModel{}
	service, id, owner := setup(t, model)
	d := fixtureDrawing()
	request := uuid.NewString()
	first, err := service.Recognize(context.Background(), id, owner, request, d)
	if err != nil || first.State != "complete" {
		t.Fatalf("recognition %v %v", first, err)
	}
	second, err := service.Recognize(context.Background(), id, owner, request, d)
	if err != nil || second.DrawingHash != first.DrawingHash || model.Calls.Load() != 1 {
		t.Fatalf("replay %v %v calls=%d", second, err, model.Calls.Load())
	}
	d.Strokes[0].Points[0][0]++
	if _, err = service.Recognize(context.Background(), id, owner, request, d); err == nil {
		t.Fatal("reused ID accepted changed drawing")
	}
	in := SaveInput{RequestID: uuid.NewString(), ExpectedVersion: 1, Name: "旋转锤", Drawing: fixtureDrawing(), Spec: *first.Spec}
	session, err := service.Save(id, owner, in)
	if err != nil || len(session.Blueprints) != 1 || session.Version != 2 {
		t.Fatalf("save %v %v", session, err)
	}
	session, err = service.Save(id, owner, in)
	if err != nil || len(session.Blueprints) != 1 {
		t.Fatalf("duplicate save %v %v", session, err)
	}
	in.RequestID = uuid.NewString()
	if _, err = service.Save(id, owner, in); err == nil {
		t.Fatal("stale version accepted")
	}
}
func TestUnknownModelOutcomeDoesNotRetryOrWriteBlueprint(t *testing.T) {
	model := &countedModel{Fail: true}
	service, id, owner := setup(t, model)
	request := uuid.NewString()
	view, err := service.Recognize(context.Background(), id, owner, request, fixtureDrawing())
	if err != nil || view.State != "outcome_unknown" {
		t.Fatalf("unknown %v %v", view, err)
	}
	view, err = service.Recognize(context.Background(), id, owner, request, fixtureDrawing())
	if err != nil || model.Calls.Load() != 1 {
		t.Fatalf("replay %v %v", view, err)
	}
	session, err := service.Read(id, owner)
	if err != nil || session.Version != 1 || len(session.Blueprints) != 0 {
		t.Fatalf("changed session %v %v", session, err)
	}
}
func TestStorageRestartAndOwnership(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := OpenStore(dir); err == nil {
		second.Close()
		t.Fatal("second process lock accepted")
	}
	service := NewService(store, FixtureRecognizer{}, "fixture", true, 10)
	session, err := service.Create(Owner{UserID: "owner"}, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	request := uuid.NewString()
	_, err = service.Recognize(context.Background(), session.ID, Owner{UserID: "owner"}, request, fixtureDrawing())
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	service = NewService(reopened, FixtureRecognizer{}, "fixture", true, 10)
	view, err := service.Receipt(session.ID, Owner{UserID: "owner"}, request)
	if err != nil || view.State != "complete" {
		t.Fatalf("restart %v %v", view, err)
	}
	if _, err = service.Read(session.ID, Owner{UserID: "stranger"}); err == nil {
		t.Fatal("foreign session exposed")
	}
}
func TestVectorAndSpecBoundaries(t *testing.T) {
	d := fixtureDrawing()
	d.Strokes[0].Points[0] = Point{5000, 0}
	if validateDrawing(d) == nil {
		t.Fatal("out of bounds drawing accepted")
	}
	d = fixtureDrawing()
	spec, _, _, _ := (FixtureRecognizer{}).Recognize(context.Background(), d)
	spec.Parts[0].Type = "unlimited_laser"
	if validateSpec(d, spec) == nil {
		t.Fatal("unknown component accepted")
	}
	var point Point
	if json.Unmarshal([]byte("[1,2,3]"), &point) == nil {
		t.Fatal("extra point coordinate accepted")
	}
	if _, _, _, err := (FixtureRecognizer{}).Recognize(context.Background(), Drawing{1, 1, 4096, []Stroke{{"custom", []Point{{1, 1}, {2000, 2000}}, 24, "ink"}}}); err == nil {
		t.Fatal("fixture recognized arbitrary drawing")
	}
}
func TestCannonBlueprintContract(t *testing.T) {
	service, id, owner := setup(t, FixtureRecognizer{})
	drawing := fixtureCannonDrawing()
	receipt, err := service.Recognize(context.Background(), id, owner, uuid.NewString(), drawing)
	if err != nil || receipt.Spec == nil || receipt.State != "complete" {
		t.Fatalf("cannon recognition: %+v %v", receipt, err)
	}
	cannon := receipt.Spec.Parts[2]
	if cannon.Type != "cannon" || cannon.AnchorHint == nil || *cannon.AnchorHint != (Point{2850, 2048}) || cannon.DirectionHint == nil {
		t.Fatalf("cannon geometry: %+v", cannon)
	}
	saved, err := service.Save(id, owner, SaveInput{RequestID: uuid.NewString(), ExpectedVersion: 1, Name: "自动炮台", Drawing: drawing, Spec: *receipt.Spec})
	if err != nil || len(saved.Blueprints) != 1 || saved.Blueprints[0].RulesVersion != RulesVersion {
		t.Fatalf("cannon save: %+v %v", saved, err)
	}
	spec := *receipt.Spec
	spec.Parts = append([]Part(nil), spec.Parts...)
	spec.Parts[1].Type = "blade"
	if validateSpec(drawing, spec) == nil {
		t.Fatal("mixed cannon/melee assembly accepted")
	}
	spec.Parts[1].Type = "cannon"
	if validateSpec(drawing, spec) == nil {
		t.Fatal("multiple cannons accepted")
	}
	encoded, _ := json.Marshal(receipt.Spec)
	encoded = append(encoded[:len(encoded)-1], []byte(`,"damage":99999}`)...)
	if decodeStrict(encoded, &Spec{}) == nil {
		t.Fatal("model-authored damage accepted")
	}
	request := httptest.NewRequest(http.MethodGet, "/api/siege/status", nil)
	response := httptest.NewRecorder()
	(&HTTP{Service: service}).Handler().ServeHTTP(response, request)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"cannon"`) {
		t.Fatalf("status: %s", response.Body.String())
	}
}

// TestHTTPRequiresOwnerAndEnforcesOrigin covers the integration boundary: the
// handler refuses a request with no member attached (the main server always
// attaches one), keeps the standalone origin check when enabled, and never
// leaks ownership metadata.
func TestHTTPRequiresOwnerAndEnforcesOrigin(t *testing.T) {
	service, _, owner := setup(t, FixtureRecognizer{})
	handler := (&HTTP{Service: service, EnforceOrigin: true}).Handler()
	create := func(origin string, ctx context.Context) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "http://game.test/api/siege/sessions", strings.NewReader(`{"requestId":"`+uuid.NewString()+`"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		if ctx != nil {
			request = request.WithContext(ctx)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	if response := create("http://evil.test", WithOwner(context.Background(), owner)); response.Code != 403 {
		t.Fatalf("foreign origin status=%d", response.Code)
	}
	if response := create("http://game.test", nil); response.Code != 401 {
		t.Fatalf("anonymous status=%d body=%s", response.Code, response.Body.String())
	}
	response := create("http://game.test", WithOwner(context.Background(), owner))
	if response.Code != 201 {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "ownerHash") {
		t.Fatal("ownership exposed")
	}
	if _, err := service.Read("00000000-0000-0000-0000-000000000000", owner); err == nil {
		t.Fatal("missing session accepted")
	}
}

type heldModel struct {
	started chan struct{}
	release chan struct{}
}

func (m heldModel) Recognize(ctx context.Context, d Drawing) (Spec, int64, int64, error) {
	close(m.started)
	select {
	case <-m.release:
		return (FixtureRecognizer{}).Recognize(ctx, d)
	case <-ctx.Done():
		return Spec{}, 0, 0, ctx.Err()
	}
}
func TestInFlightSessionRejectsConcurrentChanges(t *testing.T) {
	model := heldModel{make(chan struct{}), make(chan struct{})}
	service, id, owner := setup(t, model)
	done := make(chan error, 1)
	request := uuid.NewString()
	go func() {
		_, err := service.Recognize(context.Background(), id, owner, request, fixtureDrawing())
		done <- err
	}()
	<-model.started
	_, err := service.Receipt(id, owner, request)
	var p *Problem
	if !errors.As(err, &p) || p.Code != "service_busy" {
		t.Fatalf("concurrent receipt: %v", err)
	}
	close(model.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	view, err := service.Receipt(id, owner, request)
	if err != nil || view.State != "complete" {
		t.Fatalf("receipt: %+v %v", view, err)
	}
}
func TestCrashedReceiptAndBudgetSurviveRestart(t *testing.T) {
	service, id, owner := setup(t, &countedModel{})
	session, err := service.Read(id, owner)
	if err != nil {
		t.Fatal(err)
	}
	request := uuid.NewString()
	hash := drawingHash(fixtureDrawing())
	session.RecognitionReceipts = append(session.RecognitionReceipts, receipt{View: Recognition{RequestID: request, DrawingHash: hash, State: "processing"}, Hash: hash})
	if err := service.Store.ReserveBudget(owner, 1); err != nil {
		t.Fatal(err)
	}
	if err := service.Store.SaveSession(session); err != nil {
		t.Fatal(err)
	}
	// This test restarts the file-backed store, so it needs the directory. The
	// interface deliberately hides it; assert on the concrete type instead.
	dir := service.Store.(*fileStore).dir
	service.Store.Close()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	model := &countedModel{}
	restarted := NewService(store, model, "fixture", true, 1)
	view, err := restarted.Recognize(context.Background(), id, owner, request, fixtureDrawing())
	if err != nil || view.State != "outcome_unknown" || model.Calls.Load() != 0 {
		t.Fatalf("crash replay: %+v %v", view, err)
	}
	_, err = restarted.Recognize(context.Background(), id, owner, uuid.NewString(), fixtureDrawing())
	var p *Problem
	if !errors.As(err, &p) || p.Code != "recognition_budget" || model.Calls.Load() != 0 {
		t.Fatalf("budget reset on restart: %v", err)
	}
}
func TestStorageCapacityDoesNotReplaceExistingBlueprint(t *testing.T) {
	service, id, owner := setup(t, FixtureRecognizer{})
	spec, _, _, _ := (FixtureRecognizer{}).Recognize(context.Background(), fixtureDrawing())
	saved, err := service.Save(id, owner, SaveInput{RequestID: uuid.NewString(), ExpectedVersion: 1, Name: "first", Drawing: fixtureDrawing(), Spec: spec})
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(filepath.Join(service.Store.(*fileStore).dir, "capacity-reserved"))
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(128 * 1024 * 1024); err != nil {
		t.Fatal(err)
	}
	f.Close()
	_, err = service.Save(id, owner, SaveInput{RequestID: uuid.NewString(), ExpectedVersion: saved.Version, Name: "second", Drawing: fixtureDrawing(), Spec: spec})
	var p *Problem
	if !errors.As(err, &p) || p.Code != "storage_capacity" {
		t.Fatalf("capacity: %v", err)
	}
	actual, err := service.Read(id, owner)
	if err != nil || actual.Version != 2 || len(actual.Blueprints) != 1 || actual.Blueprints[0].Name != "first" {
		t.Fatalf("failed write damaged previous snapshot: %+v %v", actual, err)
	}
}
