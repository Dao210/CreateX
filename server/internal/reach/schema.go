package reach

import (
	"encoding/json"
)

// EntitySchema is generated from the same closed vocabularies the validator
// uses. There is one source of truth for what a generator may emit: if a value
// is legal in the schema it passes Validate, and vice versa. schema_test.go
// holds that line.
func EntitySchema() map[string]any {
	clampInt := func(field string, min, max int) map[string]any {
		return map[string]any{
			"type":        "integer",
			"minimum":     min,
			"maximum":     max,
			"description": field,
		}
	}
	enum := func(values []string) map[string]any {
		out := make([]any, len(values))
		for i, v := range values {
			out[i] = v
		}
		return map[string]any{"type": "string", "enum": out}
	}

	statBlock := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"atk", "tough", "agi", "sense", "upkeep"},
		"description":          "Point buy. The five values must sum to 100 and each is capped at 40.",
		"properties": map[string]any{
			"atk":    clampInt("Damage per strike.", 0, StatMax),
			"tough":  clampInt("Maximum HP.", 0, StatMax),
			"agi":    clampInt("Movement per beat.", 0, StatMax),
			"sense":  clampInt("How far the entity notices others.", 0, StatMax),
			"upkeep": clampInt("Charge consumed per beat. Higher upkeep is a trade, not a bonus.", 0, StatMax),
		},
	}

	weaponBlock := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"form", "dimensions", "material", "trait"},
		"properties": map[string]any{
			"form":     enum(keys(forms)),
			"material": enum(keys(materials)),
			"trait":    enum(keys(weaponTraits)),
			"dimensions": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"length", "mass"},
				"properties": map[string]any{
					"length": clampInt("Reach along the facing axis.", 1, 100),
					"mass":   clampInt("Weight. Above 60 costs speed.", 1, 100),
					"head":   clampInt("Hammer head size. Required for hammers.", 0, 100),
				},
			},
		},
	}

	return map[string]any{
		"$schema":              "https://json-schema.org/draft/2020-12/schema",
		"$id":                  "/api/reach/schema/entity-1.json",
		"title":                "REACH entity",
		"description":          "A weapon or character submitted to the REACH world. Closed vocabulary: no scripts, no free geometry.",
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"schema", "kind", "name", "appearance", "stats", "provenance"},
		"properties": map[string]any{
			"schema": map[string]any{"const": SchemaEntityV1},
			"kind":   enum([]string{KindCharacter, KindWeapon}),
			"name": map[string]any{
				"type":      "string",
				"minLength": 2,
				"maxLength": 32,
				"pattern":   "^[A-Za-z0-9 _-]+$|^[\\p{L}\\p{N} _-]+$",
			},
			"locale":     enum([]string{"en", "zh-Hans", "zh-Hant", "ja", "ko"}),
			"chassis":    enum(keys(chassisSet)),
			"weaponForm": enum(keys(forms)),
			"appearance": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"palette", "silhouette"},
				"properties": map[string]any{
					"palette": map[string]any{
						"type":     "array",
						"minItems": 3,
						"maxItems": 3,
						"items":    map[string]any{"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"},
					},
					"silhouette": enum(keys(silhouettes)),
				},
			},
			"loadout": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"weapon", "armor"},
				"properties": map[string]any{
					"weapon": weaponBlock,
					"armor": map[string]any{
						"type":                 "object",
						"additionalProperties": false,
						"required":             []string{"plate", "trait"},
						"properties": map[string]any{
							"plate": enum(keys(plates)),
							"trait": enum(keys(armorTraits)),
						},
					},
				},
			},
			"stats": statBlock,
			"policy": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"aggression", "caution", "hoard", "loyalty"},
				"description":          "Declarative temperament. The engine reads it; nothing executes it.",
				"properties": map[string]any{
					"aggression": map[string]any{"type": "number", "minimum": 0, "maximum": 1},
					"caution":    map[string]any{"type": "number", "minimum": 0, "maximum": 1},
					"hoard":      map[string]any{"type": "number", "minimum": 0, "maximum": 1},
					"loyalty":    map[string]any{"type": "number", "minimum": 0, "maximum": 1},
				},
			},
			"voice": map[string]any{
				"type":        "string",
				"maxLength":   60,
				"description": "One line, shown in the world chronicle after moderation.",
			},
			"provenance": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"generator"},
				"properties": map[string]any{
					"generator": enum(keys(generators)),
					"model":     map[string]any{"type": "string", "maxLength": 64},
					"author":    map[string]any{"type": "string", "maxLength": 64},
				},
			},
		},
		"allOf": []any{
			map[string]any{
				"if":   map[string]any{"properties": map[string]any{"kind": map[string]any{"const": KindCharacter}}},
				"then": map[string]any{"required": []string{"chassis", "loadout", "policy"}},
			},
			map[string]any{
				"if":   map[string]any{"properties": map[string]any{"kind": map[string]any{"const": KindWeapon}}},
				"then": map[string]any{"required": []string{"weaponForm"}},
			},
		},
		"x-reach-budget": map[string]any{
			"statsSum": StatBudget,
			"statsMax": StatMax,
		},
	}
}

// EntitySchemaJSON is what the endpoint serves. It is regenerated per call so a
// vocabulary change cannot drift from the published schema.
func EntitySchemaJSON() ([]byte, error) {
	return json.MarshalIndent(EntitySchema(), "", "  ")
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	// Sorted order keeps the published schema byte-stable across builds.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}
