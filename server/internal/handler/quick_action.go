package handler

import (
	"regexp"
)

// quickActionTemplateTokenRe catches any `{{...}}` in a prompt.
//
// Templating is deliberately unsupported, but silence is not the same as
// safety: someone carrying the habit over from autopilot's issue-title
// template would otherwise have `{{issue.title}}` rendered literally into an
// agent's instructions and never notice. Rejecting at write time is a fraction
// of the cost of the interpolation engine it replaces, and it keeps the door
// open to enabling variables later without touching stored data.
var quickActionTemplateTokenRe = regexp.MustCompile(`\{\{[^}]*\}\}`)

// quickActionSideEffectMentionRe catches mention markup that reaches somebody.
//
// The prompt is appended verbatim to a comment that then runs through the
// normal mention pipeline, so a mention inside it acts on every click:
//
//   - agent / squad / all -> enqueues a SECOND target beside the configured
//     one, breaking the invariant the permission model rests on (a public
//     action runs exactly the target it was validated against). The sidebar
//     reports only the first outcome, so the extra run is invisible.
//   - member -> notification_listeners.go adds them to the mention recipients
//     and creates an inbox item, so a saved prompt pings that person on every
//     single click. This one was initially allowed on the reasoning that it
//     "only renders a link"; that was wrong.
//
// `mention://issue/...` is the sole exception: it renders as a link and
// reaches nobody, so a prompt may legitimately point at related work.
var quickActionSideEffectMentionRe = regexp.MustCompile(`mention://(agent|squad|member|all)/`)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Management gate
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
