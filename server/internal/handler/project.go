package handler

// validProjectStatuses / validProjectPriorities mirror the CHECK constraints on
// the project table (migrations 034, 035). CreateProject / UpdateProject
// pre-validate against these so an unknown enum value returns a clean 400 with
// the allowed list instead of surfacing the DB CHECK violation as a 500 — the
// exact mismatch reported in #3925 (`--status active`).
var validProjectStatuses = []string{"planned", "in_progress", "paused", "completed", "cancelled"}
var validProjectPriorities = []string{"urgent", "high", "medium", "low", "none"}
