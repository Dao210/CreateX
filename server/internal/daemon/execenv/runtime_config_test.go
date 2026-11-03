package execenv

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/auro-ai/auro/server/internal/runtimeapps"
)

// Sub-issue Creation section — after MUL-2538 the platform posts the
// child-done parent notification itself, so the brief no longer carries
// any parent-notification rule (per Bohan's call on PR #3055: delete the
// guidance entirely, do not replace it with a "do not post one" sentence
// — the agent should not be thinking about parent comments at all). All
// that remains is the `--status todo` vs `--status backlog` rule for
// creating sub-issues, which is unrelated to the notification path.

// platformSkillFixture is the built-in every issue brief expects to be able to
// point at. The pointer is resolved from the task's actual skills, so a brief
// built without it deliberately carries no pointer at all.
func platformSkillFixture() SkillContextForEnv {
	return SkillContextForEnv{
		Name:    "auro-platform",
		Content: "---\nname: auro-platform\n---\n\nbody",
	}
}

// The continuity notice moved out of the brief and into the per-turn prompt
// (MUL-5377) because it is true of one run and false of the next.
func TestSessionContinuityNoticeLivesOutsideBrief(t *testing.T) {
	t.Parallel()
	for _, want := range []string{
		"## Session Continuity Notice",
		"could NOT be restored",
		"tell the user up front",
	} {
		if !strings.Contains(SessionContinuityNoticeUnrecoverable, want) {
			t.Errorf("SessionContinuityNoticeUnrecoverable missing %q", want)
		}
	}

	// The web-chat / Feishu transcript variant points at the read-back command
	// and must NOT order an announcement — the conversation survives in
	// chat_message, so "the previous context was lost" would be a false alarm.
	if !strings.Contains(SessionContinuityNoticeChatTranscript, "auro chat history") {
		t.Error("transcript variant must point at the read-back command")
	}
	if strings.Contains(SessionContinuityNoticeChatTranscript, "tell the user") {
		t.Errorf("transcript variant must not script an apology:\n%s", SessionContinuityNoticeChatTranscript)
	}
	if !strings.Contains(SessionContinuityNoticeChatTranscript, "your own working memory") {
		t.Errorf("transcript variant must state the real loss:\n%s", SessionContinuityNoticeChatTranscript)
	}

	lost := TaskContextForEnv{
		ChatSessionID: "11111111-2222-3333-4444-555555555555",

		PriorSessionResumeUnavailable: true,
	}
	if strings.Contains(buildMetaSkillContent("codex", lost), "Session Continuity Notice") {
		t.Error("brief must never carry the continuity notice — it is per-run state (MUL-5377)")
	}
}

// Workspace Context block: workspace.context (the per-workspace system prompt
// owners set in Settings → General) must reach the brief as `## Workspace
// Context` for every task kind so agents see a consistent shared system prompt
// regardless of how they were triggered. Empty content must skip the heading
// entirely — bare headings would just add noise.
func TestWorkspaceContextRenderedAcrossTaskKinds(t *testing.T) {
	t.Parallel()
	const wsContext = "All comments must be in English. Prefer concise PR descriptions."
	cases := []struct {
		name string
		ctx  TaskContextForEnv
	}{
		{
			name: "assignment-triggered",
			ctx: TaskContextForEnv{
				ChatSessionID:    "11111111-2222-3333-4444-555555555555",
				WorkspaceContext: wsContext,
			},
		},
		{
			name: "comment-triggered",
			ctx: TaskContextForEnv{
				ChatSessionID: "22222222-3333-4444-5555-666666666666",

				WorkspaceContext: wsContext,
			},
		},
		{
			name: "chat",
			ctx: TaskContextForEnv{
				ChatSessionID:    "chat-1",
				WorkspaceContext: wsContext,
			},
		},
		{
			name: "quick-create",
			ctx: TaskContextForEnv{

				WorkspaceContext: wsContext,
			},
		},
		{
			name: "autopilot run-only",
			ctx: TaskContextForEnv{
				AutopilotRunID:   "run-1",
				WorkspaceContext: wsContext,
			},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out := buildMetaSkillContent("claude", tc.ctx)

			if !strings.Contains(out, "## Workspace Context") {
				t.Fatalf("[%s] expected `## Workspace Context` heading", tc.name)
			}
			if !strings.Contains(out, wsContext) {
				t.Errorf("[%s] brief missing workspace context body %q", tc.name, wsContext)
			}
			// The block must precede Available Commands so it acts as
			// background framing, not a footer hidden below CLI usage.
			ctxIdx := strings.Index(out, "## Workspace Context")
			cmdsIdx := strings.Index(out, "## Available Commands")
			if ctxIdx == -1 || cmdsIdx == -1 || ctxIdx > cmdsIdx {
				t.Errorf("[%s] `## Workspace Context` must appear above `## Available Commands` (ctx=%d, cmds=%d)", tc.name, ctxIdx, cmdsIdx)
			}
		})
	}
}

func TestWorkspaceContextHeadingSkippedWhenEmpty(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		ctx  TaskContextForEnv
	}{
		{
			name: "empty string",
			ctx: TaskContextForEnv{
				ChatSessionID:    "11111111-2222-3333-4444-555555555555",
				WorkspaceContext: "",
			},
		},
		{
			name: "whitespace only",
			ctx: TaskContextForEnv{
				ChatSessionID:    "11111111-2222-3333-4444-555555555555",
				WorkspaceContext: "   \n\t  \r\n",
			},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out := buildMetaSkillContent("claude", tc.ctx)
			if strings.Contains(out, "## Workspace Context") {
				t.Errorf("[%s] empty workspace context must NOT emit the heading", tc.name)
			}
		})
	}
}

// Connected Apps moved to the per-turn prompt (MUL-5377): the app set is
// resolved per run from the runtime MCP overlay.
func TestConnectedAppsBlockLivesOutsideBrief(t *testing.T) {
	t.Parallel()
	apps := []runtimeapps.ConnectedApp{{
		Provider:    "composio",
		ServerName:  "composio",
		ToolkitSlug: "notion",
		ToolkitName: "Notion",
	}}

	block := BuildConnectedAppsBlock(apps)
	for _, want := range []string{
		"## Connected Apps",
		"- Notion (`notion`) via MCP server `composio`",
		"Use the listed MCP server when the task asks to read or act in one of these apps.",
	} {
		if !strings.Contains(block, want) {
			t.Fatalf("connected-apps block missing %q\n---\n%s", want, block)
		}
	}
	if BuildConnectedAppsBlock(nil) != "" {
		t.Error("empty app list must render nothing")
	}

	out := buildMetaSkillContent("claude", TaskContextForEnv{
		ChatSessionID:    "11111111-2222-3333-4444-555555555555",
		WorkspaceContext: "Prefer source-of-truth systems.",
		ConnectedApps:    apps,
	})
	if strings.Contains(out, "## Connected Apps") {
		t.Errorf("brief must not carry Connected Apps — it is per-run state (MUL-5377)\n---\n%s", out)
	}
}

func TestConnectedAppsHeadingSkippedWhenEmpty(t *testing.T) {
	t.Parallel()
	out := buildMetaSkillContent("claude", TaskContextForEnv{ChatSessionID: "11111111-2222-3333-4444-555555555555"})
	if strings.Contains(out, "## Connected Apps") {
		t.Fatalf("empty connected apps must not emit the heading")
	}
}

// writeRuntimeConfigFile is the safe replacement for the previous
// unconditional os.WriteFile of CLAUDE.md / AGENTS.md. The two
// states it must handle correctly are: file missing, file present without
// markers (user-authored content already there — the regression case from
// MUL-2753), and file present with markers (idempotent second-run replace).

func TestWriteRuntimeConfigFileCreatesMissingFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")
	const brief = "# Auro Agent Runtime\n\nbrief body line"

	if err := writeRuntimeConfigFile(path, brief); err != nil {
		t.Fatalf("writeRuntimeConfigFile returned error: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back file: %v", err)
	}
	s := string(got)
	if !strings.HasPrefix(s, runtimeMarkerBegin+"\n") {
		t.Errorf("output should start with begin marker, got:\n%s", s)
	}
	if !strings.Contains(s, brief) {
		t.Errorf("output should contain brief body, got:\n%s", s)
	}
	if !strings.Contains(s, "\n"+runtimeMarkerEnd+"\n") {
		t.Errorf("output should contain end marker followed by newline, got:\n%s", s)
	}
}

func TestWriteRuntimeConfigFilePreservesUserContent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")
	const userContent = "# User repo CLAUDE.md\n\n- rule one\n- rule two\n"
	if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
		t.Fatalf("seed user file: %v", err)
	}

	const brief = "## Auro brief\n\ninjected body"
	if err := writeRuntimeConfigFile(path, brief); err != nil {
		t.Fatalf("writeRuntimeConfigFile returned error: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back file: %v", err)
	}
	s := string(got)
	// The user's original content must be untouched and appear before the
	// injected marker block; this is the core regression case from MUL-2753.
	if !strings.HasPrefix(s, userContent) {
		t.Errorf("user content must be preserved verbatim at the top of the file, got:\n%s", s)
	}
	beginIdx := strings.Index(s, runtimeMarkerBegin)
	endIdx := strings.Index(s, runtimeMarkerEnd)
	if beginIdx < 0 || endIdx <= beginIdx {
		t.Fatalf("expected a well-formed marker block in:\n%s", s)
	}
	if beginIdx < len(userContent) {
		t.Errorf("begin marker must appear after user content, beginIdx=%d userLen=%d", beginIdx, len(userContent))
	}
	if !strings.Contains(s, brief) {
		t.Errorf("brief body missing from output:\n%s", s)
	}
}

func TestWriteRuntimeConfigFileReplacesExistingBlock(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "AGENTS.md")
	const userBefore = "# User AGENTS.md\n\nuser line above\n"
	const userAfter = "\nuser line below the block\n"
	original := userBefore +
		runtimeMarkerBegin + "\n" +
		"OLD BRIEF CONTENT THAT MUST GO AWAY\n" +
		runtimeMarkerEnd + "\n" +
		userAfter
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const newBrief = "## New Auro brief\n\nfresh body"
	if err := writeRuntimeConfigFile(path, newBrief); err != nil {
		t.Fatalf("writeRuntimeConfigFile returned error: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back file: %v", err)
	}
	s := string(got)
	if !strings.HasPrefix(s, userBefore) {
		t.Errorf("content above the marker block must be preserved, got:\n%s", s)
	}
	if !strings.HasSuffix(s, userAfter) {
		t.Errorf("content below the marker block must be preserved, got:\n%s", s)
	}
	if strings.Contains(s, "OLD BRIEF CONTENT THAT MUST GO AWAY") {
		t.Errorf("previous block body must be replaced, got:\n%s", s)
	}
	if !strings.Contains(s, newBrief) {
		t.Errorf("new brief body missing from output:\n%s", s)
	}
	if strings.Count(s, runtimeMarkerBegin) != 1 || strings.Count(s, runtimeMarkerEnd) != 1 {
		t.Errorf("there must be exactly one begin/end marker pair, got:\n%s", s)
	}
}

func TestWriteRuntimeConfigFileIsIdempotent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")
	const userContent = "# User CLAUDE.md\n\nimportant rules\n"
	if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
		t.Fatalf("seed user file: %v", err)
	}

	const brief = "## Auro brief\n\nbody"
	for i := 0; i < 5; i++ {
		if err := writeRuntimeConfigFile(path, brief); err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back file: %v", err)
	}
	s := string(got)
	if strings.Count(s, runtimeMarkerBegin) != 1 {
		t.Errorf("repeated runs must not duplicate the begin marker, count=%d, file:\n%s", strings.Count(s, runtimeMarkerBegin), s)
	}
	if strings.Count(s, runtimeMarkerEnd) != 1 {
		t.Errorf("repeated runs must not duplicate the end marker, count=%d, file:\n%s", strings.Count(s, runtimeMarkerEnd), s)
	}
	if strings.Count(s, brief) != 1 {
		t.Errorf("repeated runs must not duplicate the brief body, count=%d, file:\n%s", strings.Count(s, brief), s)
	}
	if !strings.HasPrefix(s, userContent) {
		t.Errorf("user content must remain intact at the top of the file, got:\n%s", s)
	}
}

// InjectRuntimeConfig is the production entry point — verify the marker
// semantics propagate through it for each provider's target filename.
func TestInjectRuntimeConfigPreservesUserContent(t *testing.T) {
	t.Parallel()
	cases := []struct {
		provider string
		filename string
	}{
		{"claude", "CLAUDE.md"},
		{"codebuddy", "CODEBUDDY.md"},
		{"codex", "AGENTS.md"},
		{"copilot", "AGENTS.md"},
		{"opencode", "AGENTS.md"},
		{"codearts", "AGENTS.md"},
		{"openclaw", "AGENTS.md"},
		{"hermes", "AGENTS.md"},
		{"pi", "AGENTS.md"},
		{"omp", "AGENTS.md"},
		{"cursor", "AGENTS.md"},
		{"kimi", "AGENTS.md"},
		{"reasonix", "AGENTS.md"},
		{"dsh", "AGENTS.md"},
		{"dim", "AGENTS.md"},
		{"zeroclaw", "AGENTS.md"},
		{"kiro", "AGENTS.md"},
		{"antigravity", "AGENTS.md"},
		{"qwen", "QWEN.md"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.provider, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			path := filepath.Join(dir, tc.filename)
			const userContent = "# User-authored file\n\ndon't touch this\n"
			if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
				t.Fatalf("seed: %v", err)
			}

			content, err := InjectRuntimeConfig(dir, tc.provider, TaskContextForEnv{
				ChatSessionID: "11111111-2222-3333-4444-555555555555",
			})
			if err != nil {
				t.Fatalf("InjectRuntimeConfig: %v", err)
			}
			if content == "" {
				t.Fatalf("returned brief content must be non-empty")
			}

			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			s := string(got)
			if !strings.HasPrefix(s, userContent) {
				t.Errorf("[%s] user content must be preserved verbatim at the top of %s, got:\n%s", tc.provider, tc.filename, s)
			}
			if !strings.Contains(s, runtimeMarkerBegin) || !strings.Contains(s, runtimeMarkerEnd) {
				t.Errorf("[%s] %s must contain the runtime marker block, got:\n%s", tc.provider, tc.filename, s)
			}
		})
	}
}

// CodeBuddy is a Claude Code fork but ships its own native config
// directory (~/.codebuddy, .codebuddy/) rather than reusing Claude's
// ~/.claude / CLAUDE.md paths (see
// https://www.codebuddy.ai/docs/cli/codebuddy-dir). This pins the two
// providers to different target filenames so a future edit can't
// silently re-merge them.
func TestRuntimeConfigPathDistinguishesCodebuddyFromClaude(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	claudePath := runtimeConfigPath(dir, "claude")
	codebuddyPath := runtimeConfigPath(dir, "codebuddy")

	if claudePath != filepath.Join(dir, "CLAUDE.md") {
		t.Errorf("claude runtime config path = %q, want CLAUDE.md", claudePath)
	}
	if codebuddyPath != filepath.Join(dir, "CODEBUDDY.md") {
		t.Errorf("codebuddy runtime config path = %q, want CODEBUDDY.md", codebuddyPath)
	}
	if claudePath == codebuddyPath {
		t.Fatal("claude and codebuddy must not share a runtime config path")
	}
}

func TestInjectRuntimeConfigUnknownProviderSkipsWrite(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	// Seed all candidate filenames so we can verify none of them get
	// written when the provider is unknown.
	for _, name := range []string{"CLAUDE.md", "CODEBUDDY.md", "AGENTS.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("untouched\n"), 0o644); err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}
	}

	if _, err := InjectRuntimeConfig(dir, "totally-unknown-provider", TaskContextForEnv{
		ChatSessionID: "11111111-2222-3333-4444-555555555555",
	}); err != nil {
		t.Fatalf("InjectRuntimeConfig: %v", err)
	}
	for _, name := range []string{"CLAUDE.md", "CODEBUDDY.md", "AGENTS.md"} {
		got, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if string(got) != "untouched\n" {
			t.Errorf("unknown provider must not write %s; got:\n%s", name, string(got))
		}
	}
}

// Parser hardening: the end marker must be found strictly after the begin
// marker so a stray end marker that appears earlier in user content (e.g.
// a documentation snippet showing what the wire format looks like) doesn't
// trick writeRuntimeConfigFile into thinking the file is malformed and
// appending another block on every run.
func TestWriteRuntimeConfigFileIgnoresStrayEndMarkerBeforeBegin(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")

	// Seed a file whose user-authored portion documents the marker format
	// (so the *end* marker appears before any *begin* marker), then has a
	// real block authored by an earlier Auro run below.
	const userDoc = "# Repo CLAUDE.md\n\nExample of what Auro writes:\n" +
		runtimeMarkerEnd + "\n\n# Real config below\n"
	original := userDoc +
		runtimeMarkerBegin + "\nFIRST BRIEF\n" + runtimeMarkerEnd + "\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const newBrief = "SECOND BRIEF"
	if err := writeRuntimeConfigFile(path, newBrief); err != nil {
		t.Fatalf("writeRuntimeConfigFile: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	s := string(got)

	// The user's stray end marker line plus surrounding doc text must still
	// be present, and the file must contain exactly one begin marker and
	// one *additional* end marker (so two end markers total — the stray
	// one and the one closing our block).
	if !strings.Contains(s, userDoc) {
		t.Errorf("user doc with stray end marker must be preserved verbatim, got:\n%s", s)
	}
	if got, want := strings.Count(s, runtimeMarkerBegin), 1; got != want {
		t.Errorf("expected exactly %d begin markers, got %d:\n%s", want, got, s)
	}
	if got, want := strings.Count(s, runtimeMarkerEnd), 2; got != want {
		t.Errorf("expected exactly %d end markers (1 user stray + 1 closing our block), got %d:\n%s", want, got, s)
	}
	if strings.Contains(s, "FIRST BRIEF") {
		t.Errorf("previous brief body must be replaced, got:\n%s", s)
	}
	if !strings.Contains(s, newBrief) {
		t.Errorf("new brief body missing from output:\n%s", s)
	}

	// Idempotency under the stray-end pattern: a second write must not
	// stack another block.
	if err := writeRuntimeConfigFile(path, newBrief); err != nil {
		t.Fatalf("second writeRuntimeConfigFile: %v", err)
	}
	got2, _ := os.ReadFile(path)
	s2 := string(got2)
	if got, want := strings.Count(s2, runtimeMarkerBegin), 1; got != want {
		t.Errorf("repeat write must not grow begin markers, got %d, want %d:\n%s", got, want, s2)
	}
}

// Parser hardening: a file containing only a begin marker (e.g. a previous
// run that crashed mid-write) must not cause every subsequent run to stack
// another block beneath the half-block.
func TestWriteRuntimeConfigFileReplacesMalformedHalfBlock(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "AGENTS.md")

	const userTop = "# Repo AGENTS.md\n\nrules above\n"
	const halfBlock = "leftover from crashed write\nsecond line\n"
	original := userTop + runtimeMarkerBegin + "\n" + halfBlock
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const newBrief = "recovered brief"
	if err := writeRuntimeConfigFile(path, newBrief); err != nil {
		t.Fatalf("writeRuntimeConfigFile: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	s := string(got)
	if !strings.HasPrefix(s, userTop) {
		t.Errorf("user content above the half-block must be preserved, got:\n%s", s)
	}
	if strings.Contains(s, "leftover from crashed write") {
		t.Errorf("half-block contents must be replaced, got:\n%s", s)
	}
	if got, want := strings.Count(s, runtimeMarkerBegin), 1; got != want {
		t.Errorf("expected exactly %d begin marker, got %d:\n%s", want, got, s)
	}
	if got, want := strings.Count(s, runtimeMarkerEnd), 1; got != want {
		t.Errorf("expected exactly %d end marker after recovery, got %d:\n%s", want, got, s)
	}
	if !strings.Contains(s, newBrief) {
		t.Errorf("new brief body missing from output:\n%s", s)
	}
}

// Cleanup excises the marker block, preserving every byte of surrounding
// user content. This is the local_directory invariant: a `claude` /
// `codex` run started by the user after a Auro task must see the same
// file the user wrote.
func TestCleanupRuntimeConfigPreservesUserContent(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")

	const userBefore = "# Repo CLAUDE.md\n\nuser line above\n"
	const userAfter = "\nuser line below the block\n"
	const userExpected = "# Repo CLAUDE.md\n\nuser line above\n\nuser line below the block\n"
	// Inject via the production write path so we exercise the actual
	// marker block format, not a hand-rolled approximation.
	if err := os.WriteFile(path, []byte(userBefore+userAfter), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := writeRuntimeConfigFile(path, "brief body"); err != nil {
		t.Fatalf("seed brief: %v", err)
	}

	if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
		t.Fatalf("CleanupRuntimeConfig: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	s := string(got)
	if strings.Contains(s, runtimeMarkerBegin) || strings.Contains(s, runtimeMarkerEnd) {
		t.Errorf("marker block must be removed, got:\n%s", s)
	}
	if strings.Contains(s, "brief body") {
		t.Errorf("brief body must be removed, got:\n%s", s)
	}
	if s != userExpected {
		t.Errorf("user content must be preserved byte-for-byte\n got:\n%q\nwant:\n%q", s, userExpected)
	}
}

// Cleanup removes the file entirely when the marker block was the only
// content — i.e. we created the file from scratch in a directory that had
// no pre-existing CLAUDE.md / AGENTS.md.
func TestCleanupRuntimeConfigRemovesFileWhenOnlyBlockRemained(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")

	// No seed — writeRuntimeConfigFile creates the file with only the
	// marker block inside.
	if err := writeRuntimeConfigFile(path, "brief body"); err != nil {
		t.Fatalf("seed brief: %v", err)
	}

	if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
		t.Fatalf("CleanupRuntimeConfig: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected file to be removed, stat err=%v", err)
	}
}

// Cleanup is a no-op when no marker block exists or when the file is
// missing — Cleanup is safe to call defensively from the daemon's defer.
func TestCleanupRuntimeConfigNoOpCases(t *testing.T) {
	t.Parallel()

	t.Run("missing file", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
			t.Errorf("missing file must be no-op, got: %v", err)
		}
		// And the directory must remain untouched.
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("readdir: %v", err)
		}
		if len(entries) != 0 {
			t.Errorf("expected dir to remain empty, got: %v", entries)
		}
	})

	t.Run("file without marker block", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		path := filepath.Join(dir, "CLAUDE.md")
		const userContent = "# Repo CLAUDE.md\n\nrules\n"
		if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
			t.Fatalf("seed: %v", err)
		}
		if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
			t.Errorf("no-marker-block file must be no-op, got: %v", err)
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read back: %v", err)
		}
		if string(got) != userContent {
			t.Errorf("file must be untouched\n got:\n%q\nwant:\n%q", string(got), userContent)
		}
	})

	t.Run("unknown provider", func(t *testing.T) {
		t.Parallel()
		dir := t.TempDir()
		// Seed every candidate filename to verify none of them get touched.
		for _, name := range []string{"CLAUDE.md", "CODEBUDDY.md", "AGENTS.md"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("untouched\n"), 0o644); err != nil {
				t.Fatalf("seed %s: %v", name, err)
			}
		}
		if err := CleanupRuntimeConfig(dir, "totally-unknown-provider"); err != nil {
			t.Errorf("unknown provider must be no-op, got: %v", err)
		}
		for _, name := range []string{"CLAUDE.md", "CODEBUDDY.md", "AGENTS.md"} {
			got, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			if string(got) != "untouched\n" {
				t.Errorf("unknown provider must not touch %s; got:\n%s", name, string(got))
			}
		}
	})
}

// Cleanup must handle a half-block left by a previous crashed run: begin
// marker present but no end. Otherwise the half-block would survive
// cleanup and pollute the next manual CLI invocation in the same dir.
func TestCleanupRuntimeConfigRemovesMalformedHalfBlock(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "AGENTS.md")

	const userTop = "# Repo AGENTS.md\n\nrules\n"
	original := userTop + runtimeMarkerBegin + "\nhalf-written brief no end\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := CleanupRuntimeConfig(dir, "codex"); err != nil {
		t.Fatalf("CleanupRuntimeConfig: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	s := string(got)
	if strings.Contains(s, runtimeMarkerBegin) {
		t.Errorf("half-block begin marker must be excised, got:\n%s", s)
	}
	if strings.Contains(s, "half-written brief no end") {
		t.Errorf("half-block body must be excised, got:\n%s", s)
	}
	if !strings.HasPrefix(s, userTop) {
		t.Errorf("user content above the half-block must remain, got:\n%s", s)
	}
}

// Cleanup must remove the marker block for every provider's target file,
// using the same provider→filename mapping as InjectRuntimeConfig — so a
// new provider added to one side cannot drift past the other.
func TestCleanupRuntimeConfigByProvider(t *testing.T) {
	t.Parallel()
	cases := []struct {
		provider string
		filename string
	}{
		{"claude", "CLAUDE.md"},
		{"codebuddy", "CODEBUDDY.md"},
		{"codex", "AGENTS.md"},
		{"copilot", "AGENTS.md"},
		{"opencode", "AGENTS.md"},
		{"codearts", "AGENTS.md"},
		{"openclaw", "AGENTS.md"},
		{"hermes", "AGENTS.md"},
		{"pi", "AGENTS.md"},
		{"omp", "AGENTS.md"},
		{"cursor", "AGENTS.md"},
		{"kimi", "AGENTS.md"},
		{"reasonix", "AGENTS.md"},
		{"dsh", "AGENTS.md"},
		{"dim", "AGENTS.md"},
		{"zeroclaw", "AGENTS.md"},
		{"kiro", "AGENTS.md"},
		{"antigravity", "AGENTS.md"},
		{"qwen", "QWEN.md"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.provider, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			path := filepath.Join(dir, tc.filename)
			const userContent = "# User file\n\ndon't touch this\n"
			if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
				t.Fatalf("seed: %v", err)
			}

			// Inject through the production path so cleanup runs against
			// the same wire format the agent saw.
			if _, err := InjectRuntimeConfig(dir, tc.provider, TaskContextForEnv{
				ChatSessionID: "11111111-2222-3333-4444-555555555555",
			}); err != nil {
				t.Fatalf("InjectRuntimeConfig: %v", err)
			}
			if err := CleanupRuntimeConfig(dir, tc.provider); err != nil {
				t.Fatalf("CleanupRuntimeConfig: %v", err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			s := string(got)
			if strings.Contains(s, runtimeMarkerBegin) || strings.Contains(s, runtimeMarkerEnd) {
				t.Errorf("[%s] marker block must be removed from %s, got:\n%s", tc.provider, tc.filename, s)
			}
			if s != userContent {
				t.Errorf("[%s] user content in %s must be preserved byte-for-byte\n got:\n%q\nwant:\n%q", tc.provider, tc.filename, s, userContent)
			}
		})
	}
}

// Inject → Cleanup → manual edit → Inject must converge back to the
// pre-injection state on the next Cleanup. This is the end-to-end
// regression that locks in: the user's repo is byte-identical to what
// they had before the task, every task cycle.
func TestInjectThenCleanupRoundTrip(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "CLAUDE.md")
	const userContent = "# User-authored CLAUDE.md\n\n- rule A\n- rule B\n"
	if err := os.WriteFile(path, []byte(userContent), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Two full inject→cleanup cycles — covers both the "first task on a
	// fresh user file" path and the "subsequent task hits a clean file
	// again" path.
	for i := 0; i < 2; i++ {
		if _, err := InjectRuntimeConfig(dir, "claude", TaskContextForEnv{
			ChatSessionID: "11111111-2222-3333-4444-555555555555",
		}); err != nil {
			t.Fatalf("iter %d inject: %v", i, err)
		}
		if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
			t.Fatalf("iter %d cleanup: %v", i, err)
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("iter %d read back: %v", i, err)
		}
		if string(got) != userContent {
			t.Errorf("iter %d: user file must be byte-identical to pre-injection state\n got:\n%q\nwant:\n%q", i, string(got), userContent)
		}
	}
}

// Byte-exact boundary coverage flagged in PR #3438 review (Elon): the
// previous cleanup used TrimRight + "\n" and TrimSpace-based file removal,
// which created a real diff in three boundary cases. The table walks each
// one through a full inject→cleanup cycle and asserts the file ends up
// byte-identical (or, for missing-file, that it stays missing).
func TestInjectThenCleanupRoundTripByteExactBoundaries(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		// seed describes the pre-inject filesystem state. When seedExists
		// is false the file is absent; when true the file is created with
		// seedContent (which may be empty / whitespace-only / arbitrary
		// bytes).
		seedExists  bool
		seedContent string
	}{
		{
			name:        "file missing — Inject creates, Cleanup removes",
			seedExists:  false,
			seedContent: "",
		},
		{
			name:        "pre-existing empty file (zero bytes)",
			seedExists:  true,
			seedContent: "",
		},
		{
			name:        "pre-existing whitespace-only file",
			seedExists:  true,
			seedContent: "   \n",
		},
		{
			name:        "no trailing newline",
			seedExists:  true,
			seedContent: "rules",
		},
		{
			name:        "one trailing newline (the common markdown shape)",
			seedExists:  true,
			seedContent: "# Rules\n\nbody\n",
		},
		{
			name:        "two trailing newlines",
			seedExists:  true,
			seedContent: "rules\n\n",
		},
		{
			name:        "many trailing newlines",
			seedExists:  true,
			seedContent: "rules\n\n\n\n",
		},
		{
			name:        "CRLF line endings",
			seedExists:  true,
			seedContent: "rule A\r\nrule B\r\n",
		},
		{
			name:        "no final newline AND embedded blank lines",
			seedExists:  true,
			seedContent: "para 1\n\npara 2\n\npara 3",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			path := filepath.Join(dir, "CLAUDE.md")

			if tc.seedExists {
				if err := os.WriteFile(path, []byte(tc.seedContent), 0o644); err != nil {
					t.Fatalf("seed: %v", err)
				}
			}

			// Two cycles to cover both "first inject hits user file" and
			// "subsequent inject hits a cleaned file" paths.
			for i := 0; i < 2; i++ {
				if _, err := InjectRuntimeConfig(dir, "claude", TaskContextForEnv{
					ChatSessionID: "11111111-2222-3333-4444-555555555555",
				}); err != nil {
					t.Fatalf("iter %d inject: %v", i, err)
				}
				if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
					t.Fatalf("iter %d cleanup: %v", i, err)
				}

				if !tc.seedExists {
					// Missing file must remain missing after the cycle so
					// the user's directory listing is also byte-identical
					// (no zero-byte stub left behind).
					if _, err := os.Stat(path); !os.IsNotExist(err) {
						t.Errorf("iter %d: file must remain missing, stat err=%v", i, err)
					}
					continue
				}
				got, err := os.ReadFile(path)
				if err != nil {
					t.Fatalf("iter %d read back: %v", i, err)
				}
				if string(got) != tc.seedContent {
					t.Errorf("iter %d: file must be byte-identical to seed\n got:  %q\n want: %q", i, string(got), tc.seedContent)
				}
			}
		})
	}
}

// Idempotency across the byte-exact boundaries: when a second Inject runs
// against a file that already carries a marker block (the "replace in
// place" branch), the surrounding bytes must stay untouched and the
// subsequent Cleanup must still restore the user's original file
// byte-exactly. This guards against a regression where the replace path
// would re-normalise pre/post bytes the way the old cleanup did.
func TestInjectReplaceThenCleanupRestoresByteExact(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		seedContent string
	}{
		{name: "no trailing newline", seedContent: "rules"},
		{name: "two trailing newlines", seedContent: "rules\n\n"},
		{name: "empty file", seedContent: ""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			path := filepath.Join(dir, "CLAUDE.md")
			if err := os.WriteFile(path, []byte(tc.seedContent), 0o644); err != nil {
				t.Fatalf("seed: %v", err)
			}

			// First inject — append path.
			if _, err := InjectRuntimeConfig(dir, "claude", TaskContextForEnv{
				ChatSessionID: "11111111-2222-3333-4444-555555555555",
			}); err != nil {
				t.Fatalf("first inject: %v", err)
			}
			// Second inject — replace-in-place path.
			if _, err := InjectRuntimeConfig(dir, "claude", TaskContextForEnv{
				ChatSessionID: "11111111-2222-3333-4444-555555555555",
			}); err != nil {
				t.Fatalf("second inject: %v", err)
			}
			if err := CleanupRuntimeConfig(dir, "claude"); err != nil {
				t.Fatalf("cleanup: %v", err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			if string(got) != tc.seedContent {
				t.Errorf("file must be byte-identical to seed after replace+cleanup\n got:  %q\n want: %q", string(got), tc.seedContent)
			}
		})
	}
}

// The fixed managed separator is the invariant that makes byte-exact
// cleanup possible. This test pins it: writeRuntimeConfigFile must
// produce exactly `<user-bytes><\n\n><marker-block>` for ANY non-empty
// or empty pre-existing file, with no trailing-newline normalisation.
func TestWriteRuntimeConfigFileAlwaysInsertsFixedManagedSeparator(t *testing.T) {
	t.Parallel()
	for _, seed := range []string{"", "rules", "rules\n", "rules\n\n", "rules\n\n\n\n"} {
		seed := seed
		t.Run(fmt.Sprintf("seed=%q", seed), func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			path := filepath.Join(dir, "CLAUDE.md")
			if err := os.WriteFile(path, []byte(seed), 0o644); err != nil {
				t.Fatalf("seed: %v", err)
			}
			if err := writeRuntimeConfigFile(path, "brief body"); err != nil {
				t.Fatalf("write: %v", err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read back: %v", err)
			}
			s := string(got)
			// The seed must appear verbatim at the start of the file —
			// no extra newline appended, no trailing newline trimmed.
			if !strings.HasPrefix(s, seed) {
				t.Errorf("seed bytes must survive verbatim at the start of the file\n got: %q\n seed: %q", s, seed)
			}
			// Immediately after the seed we must see the fixed managed
			// separator, then the begin marker.
			markerStart := len(seed) + len(runtimeManagedSeparator)
			if len(s) < markerStart+len(runtimeMarkerBegin) {
				t.Fatalf("file shorter than expected layout\n got: %q", s)
			}
			if got, want := s[len(seed):markerStart], runtimeManagedSeparator; got != want {
				t.Errorf("expected managed separator %q immediately after seed, got %q", want, got)
			}
			if got, want := s[markerStart:markerStart+len(runtimeMarkerBegin)], runtimeMarkerBegin; got != want {
				t.Errorf("expected begin marker after managed separator, got %q", got)
			}
		})
	}
}

// TestInjectRuntimeConfigByteIdenticalAcrossTriggers is the regression guard
// for MUL-5377.
//
// Claude Code loads the runtime brief into messages[0], ahead of the entire
// conversation. A cache breakpoint is all-or-nothing, so a single differing
// byte in this file invalidates the prompt cache for the whole history: on a
// resumed session the measured cost was ~426k re-created tokens per run, with
// only tools[]+system[] surviving.
//
// Therefore the rendered managed block must be byte-identical for the same
// (agent, issue, provider) no matter what triggered the run. Every field
// varied below is per-run state that used to be interpolated into the brief.
//
// If this test fails, do NOT relax it — move the offending value into the
// per-turn user message (daemon.BuildPrompt) instead. A "skip the write when
// the block is unchanged" guard does not help here: when a volatile field
// creeps back in the block is no longer identical, so the guard never fires
// and the cache breaks anyway.
func TestInjectRuntimeConfigByteIdenticalAcrossTriggers(t *testing.T) {
	t.Parallel()

	const issueID = "11111111-2222-3333-4444-555555555555"
	base := TaskContextForEnv{
		ChatSessionID: issueID,
		AgentID:       "agent-1",
		AgentName:     "Eve",
	}

	variants := []struct {
		name   string
		mutate func(c *TaskContextForEnv)
	}{
		{"assignment-triggered", func(c *TaskContextForEnv) {}},
		{"comment-triggered", func(c *TaskContextForEnv) {

		}},
		{"comment-triggered-other-comment", func(c *TaskContextForEnv) {

		}},
		{"resumed-with-delta", func(c *TaskContextForEnv) {

			c.PriorSessionResumed = true

		}},
		{"resume-unavailable", func(c *TaskContextForEnv) {

			c.PriorSessionResumeUnavailable = true
		}},
		{"member-initiator", func(c *TaskContextForEnv) {
			c.InitiatorType = "member"
			c.InitiatorID = "user-1"
			c.InitiatorName = "Bohan"
			c.InitiatorEmail = "bohan@example.com"
		}},
		{"agent-initiator", func(c *TaskContextForEnv) {
			c.InitiatorType = "agent"
			c.InitiatorID = "agent-9"
			c.InitiatorName = "GPT-Boy"
		}},
		{"connected-apps", func(c *TaskContextForEnv) {
			c.ConnectedApps = []runtimeapps.ConnectedApp{{
				Provider:    "composio",
				ServerName:  "composio",
				ToolkitSlug: "notion",
				ToolkitName: "Notion",
			}}
		}},
	}

	// Non-vacuity guard: the brief must still depend on its stable inputs, or
	// this whole test would pass on a function that ignores ctx entirely.
	// Since MUL-5442's cross-channel dedup the brief is deliberately
	// issue-id-independent (the per-turn message carries the ids), so the
	// guard now varies a different stable input: the agent identity.
	otherAgent := base
	otherAgent.AgentName = "Someone Else"
	if buildMetaSkillContent("claude", base) == buildMetaSkillContent("claude", otherAgent) {
		t.Fatal("brief does not vary with agent identity — byte-identity assertions below would be vacuous")
	}

	// The stronger MUL-5442 invariant this PR claims as a design benefit:
	// with identical stable inputs, two DIFFERENT issue ids must render the
	// byte-identical brief — this is what makes a cross-issue shared cache
	// prefix possible. Asserted directly, per provider, so a truncated,
	// transformed, or id-conditional use of the issue id cannot slip past
	// the Contains-based negative check.
	for _, provider := range []string{"claude", "codex"} {
		otherIssue := base
		otherIssue.ChatSessionID = "99999999-8888-7777-6666-555555555555"
		if buildMetaSkillContent(provider, base) != buildMetaSkillContent(provider, otherIssue) {
			t.Fatalf("%s brief differs across issue ids — the cross-issue cache invariant is broken", provider)
		}
	}

	for _, provider := range []string{"claude", "codex"} {
		provider := provider
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			var want string
			for i, v := range variants {
				ctx := base
				v.mutate(&ctx)
				got := buildMetaSkillContent(provider, ctx)
				if i == 0 {
					want = got
					continue
				}
				if got != want {
					t.Errorf("brief differs for variant %q — per-run state leaked into messages[0] (MUL-5377).\n%s",
						v.name, firstBriefDiff(want, got))
				}
			}
		})
	}
}

// firstBriefDiff reports the first differing byte with surrounding context so a
// failure names the offending section instead of dumping two whole briefs.
func firstBriefDiff(want, got string) string {
	n := len(want)
	if len(got) < n {
		n = len(got)
	}
	i := 0
	for i < n && want[i] == got[i] {
		i++
	}
	lo := i - 120
	if lo < 0 {
		lo = 0
	}
	hiW, hiG := i+120, i+120
	if hiW > len(want) {
		hiW = len(want)
	}
	if hiG > len(got) {
		hiG = len(got)
	}
	return "first difference at byte " + strconv.Itoa(i) +
		"\n--- baseline ---\n" + want[lo:hiW] +
		"\n--- variant ---\n" + got[lo:hiG]
}

// TestAutopilotBriefByteIdenticalAcrossRunScopedFields is the invariant
// MUL-6984 actually moved, and the one TestBriefByteIdenticalAcrossRunsForEveryKind
// cannot see: its autopilot row pins run-1 / ap-1 and its variants only mutate
// the generic resume / initiator / connected-app fields, so reinserting the
// autopilot title, source, payload or description into the brief would leave
// it green.
//
// Every field below identifies ONE run. The brief lands in messages[0], ahead
// of the whole conversation, so a per-run value here throws away the prompt
// cache for the entire history on resume (MUL-5377) — and it also gives a
// second hand-maintained copy somewhere to drift from the per-turn one, which
// is how MUL-5696 happened. Two runs of the same autopilot, and two runs of
// different autopilots, must all produce the same bytes.
func TestAutopilotBriefByteIdenticalAcrossRunScopedFields(t *testing.T) {
	t.Parallel()

	base := TaskContextForEnv{AgentID: "a-1", AgentName: "Eve", AutopilotRunID: "run-1", AutopilotID: "ap-1"}

	runs := []struct {
		name string
		ctx  TaskContextForEnv
	}{
		{"baseline", base},
		{"second run of the same autopilot", func() TaskContextForEnv {
			c := base
			c.AutopilotRunID = "run-2"
			c.AutopilotTitle = "Nightly dependency sweep"
			c.AutopilotSource = "schedule"
			c.AutopilotDescription = "Check dependencies and report outdated packages."
			c.AutopilotTriggerPayload = `{"schedule":"0 3 * * *"}`
			return c
		}()},
		{"run of a different autopilot", func() TaskContextForEnv {
			c := base
			c.AutopilotRunID = "run-3"
			c.AutopilotID = "ap-2"
			c.AutopilotTitle = "Triage inbound issues"
			c.AutopilotSource = "webhook"
			c.AutopilotDescription = "Read the payload and file one issue per report."
			c.AutopilotTriggerPayload = `{"action":"opened","issue":{"number":7,"title":"crash on start"}}`
			return c
		}()},
	}

	want := buildMetaSkillContent("claude", runs[0].ctx)
	for _, r := range runs[1:] {
		if got := buildMetaSkillContent("claude", r.ctx); got != want {
			t.Errorf("autopilot brief changed for %q — a per-run value reached the cache prefix\n%s",
				r.name, firstBriefDiff(want, got))
		}
	}

	// Byte-identity alone would also hold if the brief rendered none of these
	// AND the values never reached the agent at all. Pin the other half here:
	// the brief must not carry them, and daemon.TestBuildPromptAutopilotRunOnly
	// pins the per-turn message as the surface that does.
	for _, banned := range []string{
		"run-1", "ap-1", "Nightly dependency sweep", "Triage inbound issues",
		"schedule", "webhook", "Check dependencies", "0 3 * * *", "crash on start",
	} {
		for _, r := range runs {
			if strings.Contains(buildMetaSkillContent("claude", r.ctx), banned) {
				t.Errorf("autopilot brief (%s) carries the run-scoped value %q; the per-turn message owns it", r.name, banned)
			}
		}
	}
}

// TestBriefByteIdenticalAcrossRunsForEveryKind extends the MUL-5377 guarantee
// past issue runs.
//
// Chat sessions resume too — handler/daemon.go:2172 hands the daemon a
// PriorSessionID from the chat_session row, with the same PriorWorkDir and
// PriorSessionResumeUnavailable plumbing as an issue task. So a chat brief that
// varied per turn would lose the prompt cache exactly the same way, and a long
// chat is precisely where that hurts most. Autopilot and quick-create are
// single-shot today, but the invariant is free to hold for them too and stops a
// future resume path from silently reintroducing the bug.
func TestBriefByteIdenticalAcrossRunsForEveryKind(t *testing.T) {
	t.Parallel()

	kinds := map[string]TaskContextForEnv{
		"chat":         {ChatSessionID: "chat-1", ChatChannelType: ChannelTypeSlack, AgentID: "a-1", AgentName: "Eve"},
		"quick-create": {AgentID: "a-1", AgentName: "Eve"},
		"autopilot":    {AutopilotRunID: "run-1", AutopilotID: "ap-1", AgentID: "a-1", AgentName: "Eve"},
		// WeCom is the channel a real deployment flips the file-delivery
		// verdict on. The Slack row above catches the same leak today, but only
		// because the brief's copy is channel-agnostic; scope that copy to
		// WeCom alone and this is the row still holding the line.
		"chat-wecom": {ChatSessionID: "chat-1", ChatChannelType: ChannelTypeWecom, AgentID: "a-1", AgentName: "Eve"},
	}

	// Per-run state that changes between turns of one resumed session.
	variants := []struct {
		name   string
		mutate func(c *TaskContextForEnv)
	}{
		{"baseline", func(c *TaskContextForEnv) {}},
		{"resumed", func(c *TaskContextForEnv) { c.PriorSessionResumed = true }},
		{"resume-unavailable", func(c *TaskContextForEnv) { c.PriorSessionResumeUnavailable = true }},
		{"member-initiator", func(c *TaskContextForEnv) {
			c.InitiatorType, c.InitiatorID = "member", "u-1"
			c.InitiatorName, c.InitiatorEmail = "Bohan", "bohan@example.com"
		}},
		{"other-initiator", func(c *TaskContextForEnv) {
			// A Slack channel lets a different person trigger each turn.
			c.InitiatorType, c.InitiatorID = "member", "u-2"
			c.InitiatorName, c.InitiatorEmail = "Someone Else", "else@example.com"
		}},
		{"agent-initiator", func(c *TaskContextForEnv) {
			c.InitiatorType, c.InitiatorID = "agent", "a-9"
			c.InitiatorName = "GPT-Boy"
		}},
		{"connected-apps", func(c *TaskContextForEnv) {
			c.ConnectedApps = []runtimeapps.ConnectedApp{{
				Provider: "composio", ServerName: "composio",
				ToolkitSlug: "notion", ToolkitName: "Notion",
			}}
		}},
		{"channel-delivers-files", func(c *TaskContextForEnv) {
			// The server's file-delivery verdict arrives on every claim and is
			// a deployment fact, not a session one: an upgrade that starts
			// sending the field, or object storage being turned on or off,
			// flips it under a session already running. Both halves of that
			// flip must render the same brief, which is why the verdict is
			// stated by the per-turn chat prompt and never here.
			c.ChatChannelDeliversFiles = true
		}},
	}

	for kindName, baseCtx := range kinds {
		kindName, baseCtx := kindName, baseCtx
		t.Run(kindName, func(t *testing.T) {
			t.Parallel()
			var want string
			for i, v := range variants {
				ctx := baseCtx
				v.mutate(&ctx)
				got := buildMetaSkillContent("claude", ctx)
				if i == 0 {
					want = got
					continue
				}
				if got != want {
					t.Errorf("%s brief differs for variant %q — per-run state leaked into the cached prefix (MUL-5377).\n%s",
						kindName, v.name, firstBriefDiff(want, got))
				}
			}
		})
	}
}

// TestBriefSkillsListIsNamesOnly pins the shape of the `## Skills` section: an
// index of invocable names, with no descriptions and no per-provider branch.
//
// Descriptions were removed because every runtime CLI already builds its own
// listing from the SKILL.md frontmatter the daemon writes, so the brief's copy
// was the same routing signal paid for twice — ~3,100 tokens per brief on a
// real task, 40% of the whole brief (MUL-5529).
//
// The provider branch was removed because its fallback was wrong: it told
// providers outside a hardcoded list to look in `.agent_context/skills/`, but
// the only providers that ever reached it — grok and traecli — have their files
// written to `.grok/skills` and `.traecli/skills` and discover them natively.
func TestBriefSkillsListIsNamesOnly(t *testing.T) {
	t.Parallel()

	ctx := TaskContextForEnv{
		ChatSessionID: "issue-1",
		AgentName:     "Eve",
		AgentID:       "eve-1",
		AgentSkills: []SkillContextForEnv{
			{
				Name:        "PR Review",
				Description: "Use when reviewing a pull request for the Auro project.",
				Content:     "---\nname: pr-review\n---\n\nbody",
			},
		},
	}

	// grok and traecli are the providers that used to take the removed branch;
	// the rest are a spread across the native-discovery list.
	for _, provider := range []string{"claude", "codex", "opencode", "hermes", "grok", "traecli", "some-unknown-provider"} {
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			out := buildMetaSkillContent(provider, ctx)

			if !strings.Contains(out, "- **pr-review**\n") {
				t.Errorf("brief does not list the skill by slug:\n%s", out)
			}
			if strings.Contains(out, "Use when reviewing a pull request") {
				t.Errorf("brief still carries the skill description; the CLI's own listing already has it:\n%s", out)
			}
			if strings.Contains(out, ".agent_context/skills/") {
				t.Errorf("brief still points at the removed fallback path:\n%s", out)
			}
			if !strings.Contains(out, "discovered automatically") {
				t.Errorf("brief lost the native-discovery framing:\n%s", out)
			}
		})
	}
}

// TestBriefPointsAtThePlatformSkill pins the one recall hint the Skills section
// carries (MUL-6986).
//
// Eight domain skills advertised eight descriptions in the always-loaded
// listing; they are now one skill with one description, which is cheaper but
// gives an agent one name to guess instead of eight. This line is what pays
// that back, so it must appear whenever the skill does — an agent that cannot
// find the platform contracts is strictly worse off than before the merge.
//
// Naming is by bare name, on the stated assumption that no workspace skill
// shares a built-in's name (see builtinSlug).
func TestBriefPointsAtThePlatformSkill(t *testing.T) {
	t.Parallel()

	skill := func(name string) SkillContextForEnv {
		return SkillContextForEnv{Name: name, Content: "---\nname: " + name + "\n---\n\nbody"}
	}

	cases := []struct {
		name   string
		skills []SkillContextForEnv
		want   string // the slug the pointer must name; "" = no pointer
	}{
		{
			name:   "platform skill present",
			skills: []SkillContextForEnv{skill("auro-platform")},
			want:   "auro-platform",
		},
		{
			name:   "alongside workspace skills",
			skills: []SkillContextForEnv{skill("pr-review"), skill("auro-platform")},
			want:   "auro-platform",
		},
		{
			name:   "platform skill absent",
			skills: []SkillContextForEnv{skill("pr-review")},
			want:   "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out := buildMetaSkillContent("claude", TaskContextForEnv{
				ChatSessionID: "issue-1",
				AgentName:     "Eve",
				AgentID:       "eve-1",
				AgentSkills:   tc.skills,
			})
			if tc.want == "" {
				if strings.Contains(out, "skill and open the reference") {
					t.Errorf("brief emitted a platform pointer with no built-in platform skill present:\n%s", out)
				}
				return
			}
			want := "load the `" + tc.want + "` skill"
			if !strings.Contains(out, want) {
				t.Errorf("brief does not point at %q:\n%s", tc.want, out)
			}
			// Pinned as "the domains your task touches", never a count: a task
			// that spans squads + issues + mentions needs all three, and
			// wording that implies one would make the agent act on contracts
			// it has not read.
			if !strings.Contains(out, "for the domains your task touches") {
				t.Errorf("pointer does not route by domain:\n%s", out)
			}
			if strings.Contains(out, "the one reference") {
				t.Errorf("pointer narrows on-demand reading to a single reference:\n%s", out)
			}
		})
	}
}

// Every brief that teaches `--output json` also says not to merge stderr into
// it, because the two facts are only useful together. The CLI is right:
// confirmations go to stderr, JSON goes to stdout, and `--output json | jq` has
// always worked. It stays right only while the caller keeps the streams apart,
// and `2>&1` is ordinary shell habit. The cost of merging them is not a cosmetic
// parse error: a confirmation line inside the JSON makes the parse fail, so a
// write that SUCCEEDED reads as one that failed, and the retry posts the comment
// or sends the file a second time.
//
// The assertions are on the rule's wording, not on loose substrings, because
// `2>&1` and "look like it failed" both survive a brief that says to merge the
// streams. Each builder must carry the prohibition verbatim, exactly once, with
// the consequence attached.
//
// Both brief builders are checked, not one. The quick-create brief is a
// separate function with its own copy of the `--output json` line, so guidance
// added to the full brief alone would be missing from exactly the runs that are
// given the least context to work it out for themselves.
func TestEveryBriefThatTeachesJSONOutputAlsoWarnsAgainstMergingStderr(t *testing.T) {
	t.Parallel()
	const (
		wantFlag = "--output json"
		// The premise the rule rests on. "Do not merge them" says nothing about
		// WHICH stream carries what, so a brief that swapped the two would pass
		// every other assertion here while telling an agent the opposite of the
		// truth — the same defect one clause to the left.
		wantPremise = "writes JSON to stdout; confirmations and warnings go to stderr"
		// The prohibition itself, not just the operator it names: "Always merge
		// them (`2>&1`)" contains `2>&1` and would pass a bare-operator check.
		wantRule = "Do not merge them (`2>&1`)"
		// The consequence, in the direction that makes the rule worth obeying;
		// the inverse claim ("failed write looks like it succeeded") is a
		// different bug and must not satisfy this.
		wantWhy = "a write that SUCCEEDED look like it failed"
	)
	briefs := map[string]string{
		"full":         buildMetaSkillContent("claude", TaskContextForEnv{ChatSessionID: "11111111-2222-3333-4444-555555555555"}),
		"quick-create": buildMetaSkillContent("claude", TaskContextForEnv{}),
	}
	for name, brief := range briefs {
		if !strings.Contains(brief, wantFlag) {
			t.Fatalf("%s brief does not mention %s at all; this test's premise is gone", name, wantFlag)
		}
		if !strings.Contains(brief, wantPremise) {
			t.Errorf("%s brief teaches %s without saying %q — the rule below it is only correct while the streams carry what this says they carry", name, wantFlag, wantPremise)
		}
		switch got := strings.Count(brief, wantRule); got {
		case 1:
		case 0:
			t.Errorf("%s brief teaches %s without saying %q — the habit it has to displace is the one thing an agent will not infer", name, wantFlag, wantRule)
			continue // the reason check below would report a rule that is not there
		default:
			t.Errorf("%s brief repeats %q %d times; one rule, one place, or the next edit fixes only one of them", name, wantRule, got)
		}
		if !strings.Contains(brief, wantWhy) {
			t.Errorf("%s brief states %q without %q; a rule with no reason is the first one dropped under pressure", name, wantRule, wantWhy)
		}
	}
}
