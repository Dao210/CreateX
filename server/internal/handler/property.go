package handler

import (
	"errors"

	"github.com/auro-ai/auro/server/internal/util"
)

var validPropertyTypes = []string{"text", "number", "select", "multi_select", "date", "checkbox", "url", "actor", "multi_actor"}

// Property icons use stable catalog keys that the Web client maps to Lucide
// glyphs. Keeping this allowlist at the API boundary prevents arbitrary text
// (including emoji) from leaking into every issue surface that renders icons.
var validPropertyIcons = map[string]struct{}{
	"circle-dot": {}, "signal-high": {}, "user-round": {}, "folder-kanban": {},
	"calendar-days": {}, "tag": {}, "milestone": {}, "flag": {}, "bookmark": {},
	"star": {}, "target": {}, "shield": {}, "bug": {}, "zap": {}, "rocket": {},
	"sparkles": {}, "lightbulb": {}, "globe-2": {}, "link": {}, "hash": {},
	"list-checks": {}, "circle-check": {}, "clock-3": {}, "briefcase-business": {},
	"layers-3": {}, "gauge": {}, "database": {}, "code-2": {}, "palette": {},
	"megaphone": {}, "map-pin": {}, "package": {}, "wrench": {}, "heart": {},
	"circle-alert": {}, "lock-keyhole": {},
}

// errClientRejected marks lock-closure failures already translated to an
// HTTP status by the caller-side fail() capture.
var errClientRejected = errors.New("client rejected")

// reservedPropertyNames blocks definitions that would collide with built-in
// issue fields ("system properties"). Comparison happens on the normalized
// form: lowercased, spaces collapsed to underscores — so "Due Date", "due
// date", and "due_date" are all rejected.
var reservedPropertyNames = map[string]struct{}{
	"status": {}, "priority": {}, "assignee": {}, "project": {}, "parent": {},
	"stage": {}, "label": {}, "labels": {}, "start_date": {}, "due_date": {},
	"title": {}, "description": {}, "creator": {}, "created_at": {}, "updated_at": {},
	"metadata": {}, "properties": {},
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Actor values (MUL-6286)
// ---------------------------------------------------------------------------

// parseIssueProperties mirrors parseIssueMetadata for the properties bag.
func parseIssueProperties(raw []byte) map[string]any {
	return util.JSONObjectOrEmpty(raw)
}

// ---------------------------------------------------------------------------
// Definition handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Issue value handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// List-endpoint support: properties filter + property sort expressions
// ---------------------------------------------------------------------------

var propertyFilterOps = map[string]string{
	"contains": "",
	"gt":       ">",
	"gte":      ">=",
	"lt":       "<",
	"lte":      "<=",
	"before":   "<",
	"after":    ">",
}
