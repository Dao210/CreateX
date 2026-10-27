package siege

import "sort"

// LibraryBlueprint is a saved blueprint plus the session that owns it. The
// session id lets the workshop reopen the exact edit context.
type LibraryBlueprint struct {
	Blueprint
	SessionID string `json:"sessionId"`
}

// ListBlueprints flattens the member's sessions into one library. Blueprint
// ids are UUIDs, so deduplication is safe across retries and imports.
func (s *Service) ListBlueprints(owner Owner) ([]LibraryBlueprint, error) {
	sessions, err := s.Store.ListSessions(owner)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	out := make([]LibraryBlueprint, 0)
	for _, session := range sessions {
		for _, blueprint := range session.Blueprints {
			if blueprint.ID == "" || seen[blueprint.ID] {
				continue
			}
			seen[blueprint.ID] = true
			out = append(out, LibraryBlueprint{Blueprint: blueprint, SessionID: session.ID})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return out[i].CreatedAt > out[j].CreatedAt
		}
		return out[i].ID > out[j].ID
	})
	return out, nil
}
