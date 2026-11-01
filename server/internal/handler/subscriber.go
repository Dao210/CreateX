package handler

import (
	"errors"
)

// errTargetNoLongerMember reports that the target left the workspace between
// the handler's pre-check and the serialized write, so the caller can answer
// 403 exactly as the pre-check would have.
var errTargetNoLongerMember = errors.New("target user is no longer a workspace member")
