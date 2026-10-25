package tanks

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func testDraft() Draft {
	return Draft{Profile: Rules.Profile, Name: "Forest scout", Parts: Parts{Chassis: "light", Armor: "light", Cannon: "rapid"}, Appearance: Appearance{Body: "#26834a", Accent: "#d6ef91", Pattern: "stripe"}}
}
func TestTankToolContractMatchesPublishedSchemas(t *testing.T) {
	raw, e := os.ReadFile("../../../docs/tank-character-mcp-tools.json")
	if e != nil {
		t.Fatal(e)
	}
	var published any
	if e = json.Unmarshal(raw, &published); e != nil {
		t.Fatal(e)
	}
	current, _ := json.Marshal(map[string]any{"tools": Tools()})
	var actual any
	_ = json.Unmarshal(current, &actual)
	if !reflect.DeepEqual(actual, published) {
		t.Fatal("Run pnpm generate:tank-contracts after changing tool schemas")
	}
	for _, tool := range Tools() {
		if tool.InputSchema["required"] == nil {
			t.Fatalf("%s has null required instead of an array", tool.Name)
		}
	}
}
func TestTankCatalogMatchesSource(t *testing.T) {
	source, e := os.ReadFile("../../../packages/core/tank-defense/character-catalog.json")
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(source, catalogJSON) {
		t.Fatal("Run node scripts/generate-tank-contracts.mjs after editing the canonical catalog")
	}
}
func TestTankSharedCompilerFixtures(t *testing.T) {
	raw, e := os.ReadFile("../../../packages/core/tank-defense/character-cases.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Name     string                                                           `json:"name"`
		Draft    Draft                                                            `json:"draft"`
		Expected *struct{ Speed, Armor, ProjectileSpeed, FireInterval, Cost int } `json:"expected"`
	}
	if e = json.Unmarshal(raw, &cases); e != nil {
		t.Fatal(e)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			v := Validate(c.Draft, "custom")
			if c.Expected == nil {
				if v.Valid || len(v.Errors) == 0 || v.Errors[0].Code != "character_budget_exceeded" {
					t.Fatalf("validation=%+v", v)
				}
				return
			}
			if !v.Valid {
				t.Fatalf("validation=%+v", v)
			}
			b := v.Blueprint
			if b.Speed != c.Expected.Speed || b.Armor != c.Expected.Armor || b.ProjectileSpeed != c.Expected.ProjectileSpeed || b.FireInterval != c.Expected.FireInterval || v.Cost != c.Expected.Cost {
				t.Fatalf("compiled=%+v cost=%d, expected=%+v", b, v.Cost, c.Expected)
			}
		})
	}
}
func TestStrictTankInput(t *testing.T) {
	for _, raw := range []string{`{"name":"a","name":"b"}`, `{"parts":{"armor":"light","armor":"heavy"}}`, `{"speed":9999}`, `{} {}`, `null`, `[]`} {
		var d Draft
		if e := StrictDecode([]byte(raw), &d); e == nil {
			t.Errorf("accepted invalid draft: %s", raw)
		}
	}
	d := testDraft()
	d.Name = "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀"
	if !Validate(d, "custom").Valid {
		t.Fatal("Unicode length differs from contract")
	}
	d.Appearance.Body = "url(javascript:bad)"
	if Validate(d, "custom").Valid {
		t.Fatal("accepted non-color asset reference")
	}
}
