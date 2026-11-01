package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/spf13/cobra"

	"github.com/auro-ai/auro/server/internal/cli"
	"github.com/auro-ai/auro/server/internal/util"
)

// resolveTextFlag picks between a `--<name>` inline value, a `--<name>-stdin`
// flag, and a `--<name>-file <path>` flag, mirroring the existing `--content`
// / `--content-stdin` pattern. It returns the resolved string and an error
// when more than one source is set, or when stdin/file is requested but
// produces no body. Inline flag values are passed through
// util.UnescapeBackslashEscapes so bash-double-quoted `\n` becomes a real
// newline; stdin and file bodies are returned verbatim so literal backslashes
// survive intact.
//
// The `-file` source exists for Windows agents: piping HEREDOC content to
// `--<name>-stdin` from Windows PowerShell silently drops non-ASCII bytes
// (PowerShell 5.1's `$OutputEncoding` defaults to ASCIIEncoding when piping
// to a native command), so Chinese / Cyrillic / any non-ASCII content
// arrives as `?`. Reading a UTF-8 file directly bypasses the shell's pipe
// re-encoding entirely. See issues #2198 / #2236 / #2376.
func resolveTextFlag(cmd *cobra.Command, flagName string) (string, bool, error) {
	stdinFlag := flagName + "-stdin"
	fileFlag := flagName + "-file"
	useStdin, _ := cmd.Flags().GetBool(stdinFlag)
	inline, _ := cmd.Flags().GetString(flagName)
	filePath, _ := cmd.Flags().GetString(fileFlag)

	sources := 0
	if useStdin {
		sources++
	}
	if inline != "" {
		sources++
	}
	if filePath != "" {
		sources++
	}
	if sources > 1 {
		return "", false, fmt.Errorf("--%s, --%s, and --%s are mutually exclusive", flagName, stdinFlag, fileFlag)
	}

	if useStdin {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", false, fmt.Errorf("read stdin for --%s: %w", stdinFlag, err)
		}
		body := strings.TrimSuffix(string(data), "\n")
		if body == "" {
			return "", false, fmt.Errorf("stdin content for --%s is empty", stdinFlag)
		}
		return body, true, nil
	}
	if filePath != "" {
		if err := ensureFileFlagWithinWorkdir(cmd, fileFlag, flagName, filePath); err != nil {
			return "", false, err
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", false, fmt.Errorf("read file for --%s: %w", fileFlag, err)
		}
		body := strings.TrimSuffix(string(data), "\n")
		if body == "" {
			return "", false, fmt.Errorf("file content for --%s is empty", fileFlag)
		}
		return body, true, nil
	}
	if inline == "" {
		return "", false, nil
	}
	return util.UnescapeBackslashEscapes(inline), true, nil
}

// ensureFileFlagWithinWorkdir fails closed when a --<name>-file path resolves
// outside the current working directory, unless --allow-external-file is set.
//
// Agent task workdirs are isolated per profile and per task; machine-shared
// scratch paths like /tmp are not. MUL-4252 traced a cross-environment context
// leak to exactly this gap: a quick-create run wrote its description to a fixed
// /tmp/desc.md, the write silently failed because a *different* environment's
// run had left a stale file there minutes earlier, and --description-file then
// fed that stale content into the new issue. Requiring the file to live under
// the workdir turns "silently read another run's file" into a loud command
// failure — an "incorrect content" bug becomes a "command errored" bug.
func ensureFileFlagWithinWorkdir(cmd *cobra.Command, fileFlag, flagName, filePath string) error {
	if allow, _ := cmd.Flags().GetBool("allow-external-file"); allow {
		return nil
	}
	within, err := fileWithinWorkingDir(filePath)
	if err != nil {
		return fmt.Errorf("resolve --%s path %q: %w", fileFlag, filePath, err)
	}
	if !within {
		if !pathExists(filePath) {
			return fmt.Errorf(
				"--%s path %q does not exist; it also resolves outside the current working directory, "+
					"so --allow-external-file would not make this read succeed. Write the file inside the "+
					"task workdir (e.g. ./%s.md) and pass that path.",
				fileFlag, filePath, flagName)
		}
		return fmt.Errorf(
			"--%s path %q resolves outside the current working directory; "+
				"write agent temp files inside the run workdir (e.g. ./%s.md) rather than machine-shared "+
				"paths like /tmp, where another run's stale file can be read by mistake. "+
				"Pass --allow-external-file to override.",
			fileFlag, filePath, flagName)
	}
	return nil
}

// pathExists reports whether filePath names something on disk. It exists to
// separate the two facts the containment guard used to merge: a rejected path
// that is ALSO missing has no stale file behind it for anyone to read by
// mistake, so leading with --allow-external-file sends the caller to disable
// the guard and hit an unrelated not-found error on the retry. Any stat error
// other than "not exists" (a permission wall, a broken mount) is treated as
// "exists" so the guard keeps its own wording and stays fail-closed.
func pathExists(filePath string) bool {
	_, err := os.Stat(filePath)
	return !errors.Is(err, os.ErrNotExist)
}

// fileWithinWorkingDir reports whether filePath resolves to a location inside
// the process working directory. Both sides are canonicalized the same way, so
// aliased roots (e.g. macOS /tmp -> /private/tmp), symlinks planted inside the
// workdir, and directory junctions pointing out of it all fail closed. A path
// that does not exist yet is resolved as far as it exists, so the caller's
// os.ReadFile still surfaces the real not-found error afterwards.
//
// Windows relative paths are handed over for what they are, not for what they
// look like: `\tmp\desc.md` resolves against the workdir's volume ROOT and
// `C:tmp\desc.md` against the current directory on C:, so prefixing the
// workdir onto either would judge a shadow file while os.ReadFile opens the
// real one. util.ResolveSymlinksBestEffort preserves those kinds, for link
// targets as well as for the input itself.
func fileWithinWorkingDir(filePath string) (bool, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return false, err
	}
	base, err := util.ResolveSymlinksBestEffort(cwd)
	if err != nil {
		// The workdir's own resolution cannot be determined (an unobservable
		// drive, a reparse point no query can name). Comparing a candidate
		// against a root that cannot be named judges whatever string the
		// resolver would have guessed, so fail closed.
		return false, nil
	}
	// Canonicalize the candidate exactly the way the base was, and hand it over
	// as typed: util.ResolveSymlinksBestEffort makes it absolute itself, because
	// pre-joining it here would clean the string first and collapse a ".."
	// across a symlink — judging a different path than the one os.ReadFile then
	// opens.
	//
	// os.Getwd() returns the LOGICAL working directory when $PWD names it (a
	// shell's `cd`, and the PWD the daemon exports to agent processes, both
	// carry unresolved symlinks), so the two sides only agree once both are
	// resolved. Resolving best-effort is what makes that possible for a
	// candidate that does not exist yet — a typo, or an artifact a build step
	// never produced — and every cheaper approximation gets one direction wrong:
	//
	//   - Leaving the candidate unresolved (filepath.Clean) reads a path inside
	//     the workdir as outside it, which reports a missing file as a
	//     guardrail violation and points the caller at --allow-external-file
	//     instead of at the real error.
	//   - Resolving only one level up (filepath.Dir) still breaks once an
	//     intermediate directory is missing, and worse: with an already-
	//     canonical cwd it reads `escape/sub/x.md` — under a symlink pointing
	//     out of the workdir — as INSIDE it, because the unresolvable tail
	//     falls back to a lexical clean that never sees the symlink.
	abs, err := util.ResolveSymlinksBestEffort(filePath)
	if err != nil {
		// ErrUnresolvablePath: the kernel may open this path somewhere this
		// process cannot name — a reparse point that redirects but survives
		// both os.Readlink and a handle query, or a drive-relative path on a
		// drive whose current directory is unobservable. The string the input
		// spells is not evidence of where the kernel would read, so fail
		// closed; the caller's own os.ReadFile would surface a plain error
		// for the same path.
		return false, nil
	}
	rel, err := filepath.Rel(base, abs)
	if err != nil {
		// Two absolute paths that filepath.Rel cannot relate are on different
		// volumes, which is as far outside the workdir as a path can get. Only
		// Windows produces this: with a workdir on C:, `--content-file
		// Z:\report.md` used to surface `Rel: can't make Z:\report.md relative
		// to C:\...` as an internal resolve failure instead of the guardrail's
		// own explanation — the same misleading-diagnosis shape this guard is
		// being fixed for. Measured on 10.0.19045 / go1.26.6. There is no Unix
		// input that reaches this branch, so the windows-tagged test in this
		// package is the only thing that covers it.
		return false, nil
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false, nil
	}
	return true, nil
}

func isHTTPURL(path string) bool {
	p := strings.TrimSpace(path)
	return strings.HasPrefix(p, "http://") || strings.HasPrefix(p, "https://")
}

// ensureAttachmentWithinWorkdir applies the same workdir containment guard as
// --description-file / --content-file (MUL-4252) to a local --attachment path.
// An agent that writes a chart/report to a machine-shared path like /tmp and
// then attaches it could otherwise pick up another run's — possibly another
// workspace's — stale file (the image version of the /tmp/desc.md leak). URL
// values are filtered by the caller and never reach here. --allow-external-file
// overrides, mirroring the text-flag escape hatch.

type assigneeMatch struct {
	Type string // "member", "agent", or "squad"
	ID   string // user_id for members, agent id for agents, squad id for squads
	Name string
}

// assigneeKinds is the set of entity types a given flag is allowed to resolve
// to. Issue assignees accept all three (`issueAssigneeKinds`), while
// project lead and issue subscribers are member-or-agent only
// (`memberOrAgentKinds`) — the DB CHECK on `project.lead_type` and the
// `isWorkspaceEntity` switch in the subscriber handler both reject `squad`,
// so resolving to (squad, ...) for those callers would surface as a 500 /
// 403 instead of a clean CLI-side resolution error (MUL-2165 follow-up).
type assigneeKinds struct {
	member, agent, squad bool
}

var (
	issueAssigneeKinds = assigneeKinds{member: true, agent: true, squad: true}
	memberOrAgentKinds = assigneeKinds{member: true, agent: true}
	// Actor property values are members only (MUL-6286).
	memberOnlyKinds = assigneeKinds{member: true}
)

var assigneeResolveRetrySleep = func(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return true
	case <-timer.C:
		return false
	}
}

func getAssigneeJSON(ctx context.Context, client *cli.APIClient, path string, out any) error {
	delays := []time.Duration{100 * time.Millisecond, 250 * time.Millisecond}
	var err error
	for attempt := 0; attempt <= len(delays); attempt++ {
		err = client.GetJSON(ctx, path, out)
		if err == nil || !isRetryableAssigneeResolveError(err) || attempt == len(delays) {
			return err
		}
		if assigneeResolveRetrySleep(ctx, delays[attempt]) {
			return ctx.Err()
		}
	}
	return err
}

func isRetryableAssigneeResolveError(err error) bool {
	var netErr *cli.NetworkError
	return errors.As(err, &netErr)
}

func (k assigneeKinds) describe() string {
	parts := make([]string, 0, 3)
	if k.member {
		parts = append(parts, "member")
	}
	if k.agent {
		parts = append(parts, "agent")
	}
	if k.squad {
		parts = append(parts, "squad")
	}
	switch len(parts) {
	case 0:
		return "<none>"
	case 1:
		return parts[0]
	case 2:
		return parts[0] + " or " + parts[1]
	default:
		return strings.Join(parts[:len(parts)-1], ", ") + ", or " + parts[len(parts)-1]
	}
}

// assigneeCandidate is one directory entry matchAssignee ranks. aliases are
// additional unique identifiers that select a candidate outright, ranked with
// id matches rather than name matches — a member's email is as unambiguous as
// their id, and is what people actually have to hand. Without it,
// `--value bohan@example.com` fails to resolve.
type assigneeCandidate struct {
	assigneeMatch
	aliases []string
}

func (c assigneeCandidate) matchesAlias(input string) bool {
	for _, alias := range c.aliases {
		if alias != "" && strings.EqualFold(alias, input) {
			return true
		}
	}
	return false
}

func memberCandidates(members []map[string]any) []assigneeCandidate {
	candidates := make([]assigneeCandidate, 0, len(members))
	for _, m := range members {
		candidates = append(candidates, assigneeCandidate{
			assigneeMatch: assigneeMatch{Type: "member", ID: strVal(m, "user_id"), Name: strVal(m, "name")},
			aliases:       []string{strVal(m, "email")},
		})
	}
	return candidates
}

func resolveAssignee(ctx context.Context, client *cli.APIClient, name string, kinds assigneeKinds) (string, string, error) {
	if client.WorkspaceID == "" {
		return "", "", fmt.Errorf("workspace ID is required to resolve assignees; use --workspace-id or set AURO_WORKSPACE_ID")
	}
	if normalizeAssigneeLookupInput(name) == "" {
		return "", "", fmt.Errorf("no %s found matching %q", kinds.describe(), name)
	}

	var candidates []assigneeCandidate
	var errs []error
	var fetchAttempts int

	// Search members.
	if kinds.member {
		fetchAttempts++
		var members []map[string]any
		if err := getAssigneeJSON(ctx, client, "/api/workspaces/"+client.WorkspaceID+"/members", &members); err != nil {
			errs = append(errs, fmt.Errorf("fetch members: %w", err))
		} else {
			candidates = append(candidates, memberCandidates(members)...)
		}
	}

	// Search agents.
	if kinds.agent {
		fetchAttempts++
		var agents []map[string]any
		agentPath := "/api/agents?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
		if err := getAssigneeJSON(ctx, client, agentPath, &agents); err != nil {
			errs = append(errs, fmt.Errorf("fetch agents: %w", err))
		} else {
			for _, a := range agents {
				candidates = append(candidates, assigneeCandidate{assigneeMatch: assigneeMatch{Type: "agent", ID: strVal(a, "id"), Name: strVal(a, "name")}})
			}
		}
	}

	// Search squads. The platform allows issues to be assigned to a squad
	// (the leader agent then coordinates delegation), so squad names must
	// resolve here too for issue-assignee callers — otherwise a user saying
	// "assign to <SquadName>" silently falls through and the autopilot
	// prompt emits "Unrecognized assignee: <SquadName>" (MUL-2165). Callers
	// whose target schema is member-or-agent only (project lead, subscriber)
	// must opt out via `kinds.squad = false`.
	if kinds.squad {
		fetchAttempts++
		var squads []map[string]any
		if err := getAssigneeJSON(ctx, client, "/api/squads", &squads); err != nil {
			errs = append(errs, fmt.Errorf("fetch squads: %w", err))
		} else {
			for _, s := range squads {
				if strVal(s, "archived_at") != "" {
					continue
				}
				candidates = append(candidates, assigneeCandidate{assigneeMatch: assigneeMatch{Type: "squad", ID: strVal(s, "id"), Name: strVal(s, "name")}})
			}
		}
	}

	// If every fetch failed, report the errors instead of a misleading "not found".
	if fetchAttempts > 0 && len(errs) == fetchAttempts {
		msgs := make([]string, len(errs))
		for i, e := range errs {
			msgs[i] = e.Error()
		}
		return "", "", fmt.Errorf("failed to resolve assignee: %s", strings.Join(msgs, "; "))
	}

	return matchAssignee(name, kinds, candidates)
}

// matchAssignee resolves name against candidates a caller already fetched.
// Matches are collected into three priority buckets. Higher-priority buckets
// short-circuit lower-priority matching so that, e.g., an exact name match
// always wins over a substring collision with another candidate.
//  1. idMatches        — full UUID or 8-char ShortID (as shown by `truncateID`), or an alias.
//  2. exactMatches     — case-insensitive full name equality.
//  3. substringMatches — preserves the existing partial-name UX.
func matchAssignee(name string, kinds assigneeKinds, candidates []assigneeCandidate) (string, string, error) {
	input := normalizeAssigneeLookupInput(name)
	if input == "" {
		return "", "", fmt.Errorf("no %s found matching %q", kinds.describe(), name)
	}
	inputLower := strings.ToLower(input)

	var idMatches, exactMatches, substringMatches []assigneeMatch
	for _, c := range candidates {
		switch {
		case c.ID != "" && (strings.EqualFold(c.ID, input) || strings.EqualFold(truncateID(c.ID), input)):
			idMatches = append(idMatches, c.assigneeMatch)
		case c.matchesAlias(input):
			idMatches = append(idMatches, c.assigneeMatch)
		case strings.EqualFold(c.Name, input):
			exactMatches = append(exactMatches, c.assigneeMatch)
		case strings.Contains(strings.ToLower(c.Name), inputLower):
			substringMatches = append(substringMatches, c.assigneeMatch)
		}
	}

	for _, bucket := range [][]assigneeMatch{idMatches, exactMatches, substringMatches} {
		switch len(bucket) {
		case 0:
			continue
		case 1:
			return bucket[0].Type, bucket[0].ID, nil
		default:
			return "", "", ambiguousAssigneeError(input, bucket)
		}
	}
	return "", "", fmt.Errorf("no %s found matching %q", kinds.describe(), input)
}

func normalizeAssigneeLookupInput(raw string) string {
	input := strings.TrimSpace(raw)
	if m := util.MentionRe.FindStringSubmatch(input); len(m) == 4 && m[0] == input {
		switch m[2] {
		case "member", "agent", "squad":
			return m[3]
		}
	}
	input = strings.TrimLeftFunc(input, func(r rune) bool {
		return r == '@' || r == '＠'
	})
	return strings.TrimSpace(input)
}

func ambiguousAssigneeError(input string, matches []assigneeMatch) error {
	parts := make([]string, 0, len(matches))
	for _, m := range matches {
		parts = append(parts, fmt.Sprintf("  %s %q (%s)", m.Type, m.Name, truncateID(m.ID)))
	}
	return fmt.Errorf("ambiguous assignee %q; matches:\n%s", input, strings.Join(parts, "\n"))
}

// resolveAssigneeByID strictly resolves a canonical UUID to (assignee_type,
// assignee_id) by looking it up against the workspace's members, agents, and
// (when allowed) squads. It is the deterministic counterpart to
// resolveAssignee: callers that already hold a UUID (e.g. agents reading IDs
// from `auro workspace member list --output json`) should use this instead of
// round-tripping through name matching, which can be ambiguous in workspaces
// with overlapping names.
func resolveAssigneeByID(ctx context.Context, client *cli.APIClient, id string, kinds assigneeKinds) (string, string, error) {
	if client.WorkspaceID == "" {
		return "", "", fmt.Errorf("workspace ID is required to resolve assignees; use --workspace-id or set AURO_WORKSPACE_ID")
	}
	input := strings.TrimSpace(id)
	if !uuidRegexp.MatchString(input) {
		return "", "", fmt.Errorf("expected a canonical UUID, got %q", id)
	}

	var members []map[string]any
	var memberErr error
	if kinds.member {
		memberErr = getAssigneeJSON(ctx, client, "/api/workspaces/"+client.WorkspaceID+"/members", &members)
	}

	var agents []map[string]any
	var agentErr error
	if kinds.agent {
		agentPath := "/api/agents?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
		agentErr = getAssigneeJSON(ctx, client, agentPath, &agents)
	}

	var squads []map[string]any
	var squadErr error
	if kinds.squad {
		squadErr = getAssigneeJSON(ctx, client, "/api/squads", &squads)
	}

	allFailed := true
	hasFetch := false
	for _, pair := range []struct {
		enabled bool
		err     error
	}{{kinds.member, memberErr}, {kinds.agent, agentErr}, {kinds.squad, squadErr}} {
		if !pair.enabled {
			continue
		}
		hasFetch = true
		if pair.err == nil {
			allFailed = false
		}
	}
	if hasFetch && allFailed {
		return "", "", fmt.Errorf("failed to resolve assignee: %v; %v; %v", memberErr, agentErr, squadErr)
	}

	for _, m := range members {
		if strings.EqualFold(strVal(m, "user_id"), input) {
			return "member", strVal(m, "user_id"), nil
		}
	}
	for _, a := range agents {
		if strings.EqualFold(strVal(a, "id"), input) {
			return "agent", strVal(a, "id"), nil
		}
	}
	for _, s := range squads {
		if strings.EqualFold(strVal(s, "id"), input) {
			return "squad", strVal(s, "id"), nil
		}
	}

	return "", "", fmt.Errorf("no %s found with ID %q", kinds.describe(), input)
}

// pickAssigneeFromFlags reads a (name-flag, id-flag) pair off cmd and resolves
// it to (assignee_type, assignee_id), restricted to the entity types in
// kinds. The third return reports whether either flag was *explicitly set*;
// callers use it to decide whether to write `assignee_*` into the request
// body. The two flags are mutually exclusive — passing both is rejected
// up-front so a script that accidentally sets both never silently applies one
// over the other.
//
// Presence is detected via Flags().Changed (not value-emptiness): a script
// that interpolates an empty env var (`--assignee-id "$MAYBE_UUID"`) must
// fail loudly through resolveAssignee/resolveAssigneeByID rather than silently
// degrade to "no filter / unassigned / subscribe caller", which would defeat
// the strict-UUID guarantee the new flags exist for.
func pickAssigneeFromFlags(ctx context.Context, client *cli.APIClient, cmd *cobra.Command, nameFlag, idFlag string, kinds assigneeKinds) (string, string, bool, error) {
	nameSet := cmd.Flags().Changed(nameFlag)
	idSet := cmd.Flags().Changed(idFlag)
	if nameSet && idSet {
		return "", "", false, fmt.Errorf("--%s and --%s are mutually exclusive", nameFlag, idFlag)
	}
	if idSet {
		idVal, _ := cmd.Flags().GetString(idFlag)
		t, i, err := resolveAssigneeByID(ctx, client, idVal, kinds)
		if err != nil {
			return "", "", true, err
		}
		return t, i, true, nil
	}
	if nameSet {
		name, _ := cmd.Flags().GetString(nameFlag)
		t, i, err := resolveAssignee(ctx, client, name, kinds)
		if err != nil {
			return "", "", true, err
		}
		return t, i, true, nil
	}
	return "", "", false, nil
}

func truncateID(id string) string {
	if utf8.RuneCountInString(id) > 8 {
		runes := []rune(id)
		return string(runes[:8])
	}
	return id
}

// compactComments strips response fields that carry no information for a
// reader: the issue_id echoed from the request path, per-run bookkeeping
// (source_task_id), updated_at when identical to created_at, null-valued
// keys, and empty arrays. Everything else — content, identity, thread
// summary fields — passes through untouched. Opt-in via --compact and
// applied to JSON output only: the two bounded reads the agent workflow
// prescribes are dominated by exactly this metadata (56% of a
// --roots-only --summary scan, 21% of a --thread --tail read, measured on
// a production issue), and it compounds through the prompt-cache prefix
// (#5999 follow-up, MUL-5442).
