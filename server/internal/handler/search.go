package handler

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// searchStatementTimeout bounds every /search request at the Postgres level.
//
// SearchProjects runs LOWER(col) LIKE '%pattern%' queries whose fast path
// depends on pg_bigm / pg_trgm GIN indexes (see migrations 032, 033, 036,
// 137–142). SearchIssues instead deliberately uses a candidate-first plan that
// scans each selected workspace's issues and comments once, avoiding repeated
// global GIN/hashed-subplan work at the cost of giving up content-index
// selectivity. Missing extensions or an unexpectedly large workspace can
// therefore still make either path slow enough that the frontend appears to
// hang ("搜索卡死没有任何反应", MUL-4059).
//
// The 8 s cap adds three seconds of headroom above the MUL-7146 requests that
// reached the previous 5 s database fuse, while remaining bounded well below
// the mobile API client's 30 s request timeout. Interactive web callers cancel
// superseded searches, limiting how long abandoned work can occupy a pooled
// connection. On timeout the caller sees a 503 with a descriptive error rather
// than a stalled connection — SearchIssues / SearchProjects map SQLSTATE 57014
// to http.StatusServiceUnavailable so the frontend can distinguish this from a
// generic 500.
const (
	searchWorkMemEnv       = "DATABASE_SEARCH_WORK_MEM_MB"
	defaultSearchWorkMemMB = 64
)

// configuredSearchWorkMemMB removes the candidate-first comment aggregation
// spill seen at Postgres' 4 MB default. work_mem is a per-node ceiling, not a
// reservation: the production plan's dominant sort used about 9 MB, but the
// query has roughly three memory-using sort/hash nodes. With the default 25
// primary connections, the theoretical ceiling is therefore about 4.8 GB per
// API process's connection set, not 1.6 GB for the whole query set. Actual use
// is demand-driven and was much lower in the measured plan.
//
// runSearchQuery backs both issue and project search. Project search inherits
// the same ceiling, but its indexed candidate and small sort do not approach it;
// no memory is reserved merely by setting the ceiling. Keep this transaction-
// local so unrelated pooled work retains its database default. Self-hosted
// operators can set DATABASE_SEARCH_WORK_MEM_MB to 0 to keep that default or to
// 1-64 to lower the cap; higher values are rejected to avoid expanding risk.
var configuredSearchWorkMemMB = searchWorkMemMBFromEnv()

func parseSearchWorkMemMB(raw string) (int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return defaultSearchWorkMemMB, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 || value > defaultSearchWorkMemMB {
		return defaultSearchWorkMemMB, false
	}
	return value, true
}

func searchWorkMemMBFromEnv() int {
	raw := os.Getenv(searchWorkMemEnv)
	value, ok := parseSearchWorkMemMB(raw)
	if !ok {
		slog.Warn("invalid search work_mem; using default",
			"name", searchWorkMemEnv,
			"value", raw,
			"default_mb", defaultSearchWorkMemMB,
		)
	}
	return value
}

// searchStatementTimeoutOverride, when non-zero, replaces
// searchStatementTimeout for the duration of a test. Never read outside
// of the runSearchQuery hot path — see search_timeout_test.go.
var searchStatementTimeoutOverride time.Duration
