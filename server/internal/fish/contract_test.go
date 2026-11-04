package fish

import (
	_ "embed"
	"encoding/json"
	"github.com/auro-ai/auro/server/internal/testutil"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFishCatalogAndStrictDrafts(t *testing.T) {
	if len(Rules.Examples) != 6 {
		t.Fatal("six distinct examples required")
	}
	for _, d := range Rules.Examples {
		if v := Validate(d); !v.Valid {
			t.Fatalf("%s: %+v", d.Name, v)
		}
	}
	for _, raw := range []string{`null`, `{"profile":"fish@1"}`, `{"profile":"fish@1","script":"run()"}`} {
		var d Draft
		if StrictDecode([]byte(raw), &d) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	base, _ := json.Marshal(Rules.Examples[0])
	var fields map[string]any
	_ = json.Unmarshal(base, &fields)
	delete(fields["behavior"].(map[string]any), "schooling")
	raw, _ := json.Marshal(fields)
	var d Draft
	if StrictDecode(raw, &d) == nil {
		t.Fatal("missing required zero-compatible field accepted")
	}
	d = Rules.Examples[0]
	d.Body.Sections = append([]Section{}, d.Body.Sections...)
	d.Body.Sections[1].U = 0
	if Validate(d).Valid {
		t.Fatal("unordered sections accepted")
	}
	d = Rules.Examples[0]
	d.Fins = append([]Fin{}, d.Fins...)
	d.Fins[0].Outline = []Point{{0, 0}, {0, 100}, {40, 30}, {100, 100}, {100, 0}}
	if Validate(d).Valid {
		t.Fatal("concave fin accepted")
	}
}
func TestFishHTTPTrustBoundary(t *testing.T) {
	h := (&HTTP{}).Handler()
	r := testutil.JSONRequest("GET", "/api/fish/v1/catalog", nil)
	testutil.Call(t, h.ServeHTTP, r).Want(401)
	r = testutil.JSONRequest("POST", "/api/fish/v1/validate", map[string]any{"draft": Rules.Examples[0]})
	r = r.WithContext(WithActor(r.Context(), Actor{"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"}))
	var v Validation
	testutil.Call(t, h.ServeHTTP, r).Want(200).JSON(&v)
	if !v.Valid {
		t.Fatalf("%+v", v)
	}
}
func TestFishMCPReadOnlyHandshakeAndOrigin(t *testing.T) {
	h := (&HTTP{AllowedOrigins: []string{"https://app.example.invalid"}}).Handler()
	call := func(method string, params any, origin string) *httptest.ResponseRecorder {
		r := testutil.JSONRequest("POST", "/api/fish/mcp", map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
		r.Header.Set("Accept", "application/json, text/event-stream")
		r.Header.Set("Origin", origin)
		r = r.WithContext(WithActor(r.Context(), Actor{"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := call("initialize", map[string]any{"protocolVersion": ProtocolVersion, "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test", "version": "1"}}, "https://evil.invalid"); w.Code != http.StatusForbidden {
		t.Fatalf("origin=%d", w.Code)
	}
	w := call("initialize", map[string]any{"protocolVersion": ProtocolVersion, "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test", "version": "1"}}, "https://app.example.invalid")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("tools/call", map[string]any{"name": "fish_get_catalog", "arguments": map[string]any{}}, ""); !json.Valid(w.Body.Bytes()) {
		t.Fatal(w.Body.String())
	}
}

//go:embed contract-cases.gen.json
var contractCases []byte

func TestFishSharedContractCases(t *testing.T) {
	var cases []struct {
		Name    string `json:"name"`
		Valid   bool   `json:"valid"`
		Changes []struct {
			Path  []any `json:"path"`
			Value any   `json:"value"`
		} `json:"changes"`
	}
	if e := json.Unmarshal(contractCases, &cases); e != nil {
		t.Fatal(e)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			raw, _ := json.Marshal(Rules.Examples[0])
			var value any
			_ = json.Unmarshal(raw, &value)
			for _, change := range tc.Changes {
				parent := value
				for _, segment := range change.Path[:len(change.Path)-1] {
					switch p := parent.(type) {
					case map[string]any:
						parent = p[segment.(string)]
					case []any:
						parent = p[int(segment.(float64))]
					}
				}
				last := change.Path[len(change.Path)-1]
				switch p := parent.(type) {
				case map[string]any:
					p[last.(string)] = change.Value
				case []any:
					p[int(last.(float64))] = change.Value
				}
			}
			raw, _ = json.Marshal(value)
			var draft Draft
			err := StrictDecode(raw, &draft)
			valid := err == nil && Validate(draft).Valid
			if valid != tc.Valid {
				t.Fatalf("valid=%v want=%v err=%v", valid, tc.Valid, err)
			}
		})
	}
}
