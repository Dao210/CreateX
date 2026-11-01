package handler

import (
	"regexp"
)

// searchIndexBootstrapSlots bounds the manifest and snapshot reads one API
// process runs at once. Every client builds its first copy with these, and they
// all start together right after a release or an outage; without a bound that
// herd would take most of the connection pool. Callers that cannot get a slot
// soon answer 503 with Retry-After, and clients back off with jitter.
var searchIndexBootstrapSlots = make(chan struct{}, 4)

var pgSnapshotTextRe = regexp.MustCompile(`^[0-9]{1,20}:[0-9]{1,20}:([0-9]{1,20}(,[0-9]{1,20})*)?$`)
