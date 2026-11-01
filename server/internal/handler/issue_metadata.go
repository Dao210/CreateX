package handler

import (
	"regexp"
	"sync/atomic"

	"github.com/auro-ai/auro/server/internal/util"
)

var issueMetadataKeyRE = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$`)

var issueMetadataMutationLogSequence atomic.Uint64

// parseIssueMetadata decodes the JSONB bytes from db.Issue.Metadata into a
// Go map suitable for response serialization. Empty or unparseable blobs
// degrade to an empty map — the DB CHECK guarantees object shape, so this
// path is only hit on rows somehow predating the migration. Shared with the
// service-layer broadcast rendering (service.IssueToMap) so both ways of
// describing an issue agree on what an unset bag looks like on the wire.
func parseIssueMetadata(raw []byte) map[string]any {
	return util.JSONObjectOrEmpty(raw)
}
