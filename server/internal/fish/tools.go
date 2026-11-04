package fish

import "encoding/json"

func Tools() []Tool {
	id := map[string]any{"type": "string", "format": "uuid"}
	revision := map[string]any{"type": "integer", "minimum": 1, "maximum": 50}
	hash := map[string]any{"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"}
	residentRevision := map[string]any{"type": "integer", "minimum": 1, "maximum": 10000}
	ref := func(apply bool) map[string]any {
		p := map[string]any{"requestId": id, "oceanId": id, "fishId": id, "revision": revision, "contentHash": hash}
		required := []string{"requestId", "fishId", "revision", "contentHash"}
		if apply {
			p["residentId"] = id
			p["expectedResidentRevision"] = residentRevision
			required = append(required, "oceanId", "residentId", "expectedResidentRevision")
		}
		return object(p, required...)
	}
	defs := []struct {
		name, description string
		schema            map[string]any
		read              bool
	}{
		{"fish_get_catalog", "Read fish@1 schema, shape budgets, movement semantics and six editable examples. Generate a distinctive body and fins, never scripts or external assets.", object(map[string]any{}), true},
		{"fish_validate", "Validate a fish description. Returns exact field errors; invalid shapes are never replaced with defaults.", object(map[string]any{"draft": json.RawMessage(Rules.DraftSchema)}, "draft"), true},
		{"fish_save", "Save a private owned fish or append an immutable revision using expectedRevision. Reuse requestId unchanged on retry. Saving does not replace an ocean resident.", object(map[string]any{"requestId": id, "draft": json.RawMessage(Rules.DraftSchema), "fishId": id, "expectedRevision": revision}, "requestId", "draft"), false},
		{"fish_list", "List this member's private fish creations in this world, including archived flags and exact version references.", object(map[string]any{}), true},
		{"fish_get", "Read an owned fish, latest or an immutable revision.", object(map[string]any{"fishId": id, "revision": revision}, "fishId"), true},
		{"fish_get_ocean", "Read your ocean, or an explicitly world-visible ocean. Returns ocean:null if your ocean has not been created.", object(map[string]any{"oceanId": id}), true},
		{"fish_create_ocean", "Ensure this member has a private ocean in the current world. Reuse requestId on retry; repeated calls never create another ocean.", object(map[string]any{"requestId": id}, "requestId"), false},
		{"fish_release", "Release an exact owned fish revision/hash. Omit oceanId to use your personal ocean in this world and create it if needed. Returns resident and oceanUrl. Reuse the same requestId and arguments on retry.", ref(false), false},
		{"fish_apply_revision", "Explicitly apply a saved revision to an existing resident, preserving its identity. Requires expectedResidentRevision and exact hash.", ref(true), false},
		{"fish_recall", "Recall your resident while preserving the fish creation. Reuse requestId on retry; expectedResidentRevision prevents overwriting concurrent changes.", object(map[string]any{"requestId": id, "residentId": id, "expectedResidentRevision": residentRevision}, "requestId", "residentId", "expectedResidentRevision"), false},
	}
	out := make([]Tool, 0, len(defs))
	for _, d := range defs {
		out = append(out, Tool{Name: d.name, Description: d.description, InputSchema: d.schema, Annotations: map[string]any{"readOnlyHint": d.read, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}})
	}
	return out
}
