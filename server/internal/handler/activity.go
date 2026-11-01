package handler

import (
	"net/http"
	"sort"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

// timelineHardCap bounds the per-issue timeline payload. Sized as a defensive
// safety net, not a UX page window: see commentHardCap in comment.go for the
// data-shape rationale (#1929). A variable only so the cap tests can shrink it,
// like commentHardCap; nothing outside tests assigns it.
var timelineHardCap = 2000

// Truncation is signalled with a response header rather than a body field
// because the unpaginated response is a bare JSON array (TimelineEntriesSchema =
// z.array(TimelineEntrySchema) in packages/core/api/schemas.ts) with nowhere to
// put a flag. The header is additive: existing clients keep validating.
//
// The value names which kinds were truncated ("activity", "comment", or
// "activity,comment") because the two caps are independent — in practice it is
// almost always activity alone.
//
// There is deliberately no companion "window from" header. An earlier revision
// emitted one, but TimestampToString is second-precision RFC3339 while the real
// ordering key is (created_at, id) at full precision, so it could not be used to
// resume a read without skipping or repeating rows inside a shared second. A
// resumable cursor needs to be opaque and carry both halves; that is worth
// designing when there is a consumer, not shipping as a lossy approximation.
//
// Exported so the CORS layer can reference the same identifier
// (corsExposedHeaders in server/cmd/server/router.go). A custom response header
// is invisible to browser JS unless explicitly exposed, so a rename here that
// did not reach the CORS list would silently switch the signal back off.
const HeaderTimelineTruncated = "X-Timeline-Truncated"

// AssigneeFrequencyEntry represents how often a user assigns to a specific target.
type AssigneeFrequencyEntry struct {
	AssigneeType string `json:"assignee_type"`
	AssigneeID   string `json:"assignee_id"`
	Frequency    int64  `json:"frequency"`
}

// GetAssigneeFrequency returns assignee usage frequency for the current user,
// combining data from assignee change activities and initial issue assignments.
func (h *Handler) GetAssigneeFrequency(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := h.resolveWorkspaceID(r)

	// Aggregate frequency from both data sources.
	freq := map[string]int64{} // key: "type:id"

	// Source 1: assignee_changed activities by this user.
	activityCounts, err := h.Queries.CountAssigneeChangesByActor(r.Context(), db.CountAssigneeChangesByActorParams{
		WorkspaceID: parseUUID(workspaceID),
		ActorID:     parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get assignee frequency")
		return
	}
	for _, row := range activityCounts {
		aType, _ := row.AssigneeType.(string)
		aID, _ := row.AssigneeID.(string)
		if aType != "" && aID != "" {
			freq[aType+":"+aID] += row.Frequency
		}
	}

	// Source 2: issues created by this user with an assignee.
	issueCounts, err := h.Queries.CountCreatedIssueAssignees(r.Context(), db.CountCreatedIssueAssigneesParams{
		WorkspaceID: parseUUID(workspaceID),
		CreatorID:   parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get assignee frequency")
		return
	}
	for _, row := range issueCounts {
		if !row.AssigneeType.Valid || !row.AssigneeID.Valid {
			continue
		}
		key := row.AssigneeType.String + ":" + uuidToString(row.AssigneeID)
		freq[key] += row.Frequency
	}

	// Build sorted response.
	result := make([]AssigneeFrequencyEntry, 0, len(freq))
	for key, count := range freq {
		// Split "type:id" — type is always "member" or "agent" (no colons).
		var aType, aID string
		for i := 0; i < len(key); i++ {
			if key[i] == ':' {
				aType = key[:i]
				aID = key[i+1:]
				break
			}
		}
		result = append(result, AssigneeFrequencyEntry{
			AssigneeType: aType,
			AssigneeID:   aID,
			Frequency:    count,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Frequency > result[j].Frequency
	})

	writeJSON(w, http.StatusOK, result)
}
