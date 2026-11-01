package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Execution modes for resource_type=local_directory. The zero value (absent
// field) means in_place, so resources created before worktree mode existed keep
// their original behavior without a data migration.
const (
	// localDirectoryModeInPlace runs the agent directly in the user's
	// directory, serialised by the daemon's per-path mutex: one task at a
	// time, edits land in the user's working tree.

	// localDirectoryModeWorktree runs each task in its own git worktree of
	// the user's repo, created inside the daemon's env root. Tasks on the
	// same directory run concurrently and deliver their work as a branch.
	// Only valid when the directory is a git working tree — the daemon
	// verifies that at task time, since the server can't see the filesystem.
	localDirectoryModeWorktree = "worktree"
)

// localDirectoryRef is the JSONB shape stored for resource_type=local_directory.
// It pins a project to an existing directory on a specific user machine. The
// daemon_id scopes the path to one daemon registration — the same string path
// on a different machine is a different resource. The optional label is a
// human-readable hint used by the UI; the row-level project_resource.label
// column remains the generic column for any resource type.
//
// execution_mode selects how tasks share that directory: in_place (default)
// keeps the historical one-task-at-a-time behavior, worktree gives each task an
// isolated git worktree so tasks run concurrently.
type localDirectoryRef struct {
	LocalPath     string `json:"local_path"`
	DaemonID      string `json:"daemon_id"`
	Label         string `json:"label,omitempty"`
	ExecutionMode string `json:"execution_mode,omitempty"`
}

// isValidGitRepoURL accepts the three forms a user can paste from GitHub's
// "Code" menu: https://, ssh:// (with explicit scheme), and the scp-like
// shorthand `git@host:owner/repo.git`. The check is intentionally lax — we are
// guarding against pasted garbage like "not-a-url", not enforcing a strict
// grammar — because the actual fetch happens client-side via `git clone` and
// the user gets a clearer error from git than from us.
func isValidGitRepoURL(s string) bool {
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		switch u.Scheme {
		case "http", "https", "ssh", "git":
			return true
		}
	}
	// scp-like ssh shorthand: [user@]host:path with a non-empty host and path,
	// and no spaces. Reject anything that looks like a URL with a scheme
	// (those should go through url.Parse above).
	if strings.Contains(s, " ") || strings.Contains(s, "://") {
		return false
	}
	colon := strings.Index(s, ":")
	if colon <= 0 || colon == len(s)-1 {
		return false
	}
	// In scp-like ssh shorthand `[user@]host:path`, `@` is only meaningful
	// as a user separator before the first ':'. If '@' appears at or after
	// the colon it is not the user separator — reject as malformed rather
	// than guess (and avoid a slice-bounds panic from blindly slicing).
	at := strings.Index(s, "@")
	if at >= colon {
		return false
	}
	hostStart := 0
	if at >= 0 {
		hostStart = at + 1
	}
	host := s[hostStart:colon]
	path := s[colon+1:]
	if host == "" || path == "" {
		return false
	}
	return true
}

// claimProjectContext is the project-scoped context a daemon claim exposes to
// the agent: the project identity the prompt names, the resource manifest
// execenv materializes into .auro/project/resources.json, and the repo list
// `auro repo checkout` reads.
type claimProjectContext struct {
	ProjectID   string
	Title       string
	Description string
	Resources   []ProjectResourceData
	Repos       []RepoData
}

// applyTo copies the resolved context onto a claim response. Callers assign the
// whole context or none of it, so a claim can never carry a project's title
// without its resources.
func (c claimProjectContext) applyTo(resp *AgentTaskResponse) {
	resp.ProjectID = c.ProjectID
	resp.ProjectTitle = c.Title
	resp.ProjectDescription = c.Description
	if len(c.Resources) > 0 {
		resp.ProjectResources = c.Resources
	}
	resp.Repos = c.Repos
}

// resolveClaimProjectContext loads the project context for one daemon claim.
//
// Every claim path (issue, chat, autopilot, quick-create) resolves the same
// thing from a soft project reference, so the tenant and failure rules live
// here once rather than in a copy per path:
//
//   - Both reads are workspace-scoped. project_resource carries its own
//     workspace_id, so a corrupt project reference cannot lift another tenant's
//     repository URLs or local paths into a claim.
//   - A read FAILURE is not "no project". It returns an error so the caller can
//     preserve the task for redelivery; collapsing it into the workspace-repo
//     fallback is what lets a transient DB error silently run an agent against
//     the wrong repository (the same rule the chat-input load follows,
//     MUL-4351).
//   - A project that resolves to no row IS "no project": the reference is stale,
//     deleted, or points outside this workspace, and the claim degrades to
//     workspace context.
//
// Repo precedence: project-bound github_repo resources override workspace repos
// when present. Mixing both would just confuse the agent — if a project
// explicitly attached its repos, those are the authoritative set. With no
// project, no github_repo resources, or a stale reference, the workspace repos
// are the fallback.
func (h *Handler) resolveClaimProjectContext(ctx context.Context, projectID, workspaceID pgtype.UUID) (claimProjectContext, error) {
	var out claimProjectContext

	if projectID.Valid {
		project, err := h.Queries.GetProjectInWorkspace(ctx, db.GetProjectInWorkspaceParams{
			ID:          projectID,
			WorkspaceID: workspaceID,
		})
		switch {
		case err == nil:
			out.ProjectID = uuidToString(project.ID)
			out.Title = project.Title
			out.Description = project.Description.String

			rows, resErr := h.Queries.ListProjectResourcesInWorkspace(ctx, db.ListProjectResourcesInWorkspaceParams{
				ProjectID:   project.ID,
				WorkspaceID: workspaceID,
			})
			if resErr != nil {
				return claimProjectContext{}, fmt.Errorf("list project resources: %w", resErr)
			}
			out.Resources, out.Repos = projectResourcesForClaim(rows)
		case errors.Is(err, pgx.ErrNoRows):
			// Stale/deleted/foreign reference: degrade to workspace context.
		default:
			return claimProjectContext{}, fmt.Errorf("get project: %w", err)
		}
	}

	if len(out.Repos) > 0 {
		return out, nil
	}

	ws, err := h.Queries.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return claimProjectContext{}, fmt.Errorf("get workspace: %w", err)
	}
	if ws.Repos != nil {
		var repos []RepoData
		if jsonErr := json.Unmarshal(ws.Repos, &repos); jsonErr != nil {
			// Corrupt stored JSON is not transient: failing the claim would
			// wedge every claim in this workspace until someone repairs the
			// row. Degrade to no repos and leave a trail instead.
			slog.Error("claim project context: workspace repos are not valid JSON; claiming without repos",
				"workspace_id", uuidToString(workspaceID), "error", jsonErr)
		} else if len(repos) > 0 {
			out.Repos = repos
		}
	}
	return out, nil
}

// projectResourcesForClaim maps resource rows onto the claim wire shape and
// lifts github_repo resources into the repo list so `auro repo checkout` and
// the meta-skill render them as the task's repos.
func projectResourcesForClaim(rows []db.ProjectResource) ([]ProjectResourceData, []RepoData) {
	if len(rows) == 0 {
		return nil, nil
	}
	resources := make([]ProjectResourceData, 0, len(rows))
	var repos []RepoData
	for _, row := range rows {
		label := ""
		if row.Label.Valid {
			label = row.Label.String
		}
		ref := json.RawMessage(row.ResourceRef)
		if len(ref) == 0 {
			ref = json.RawMessage("{}")
		}
		resources = append(resources, ProjectResourceData{
			ID:           uuidToString(row.ID),
			ResourceType: row.ResourceType,
			ResourceRef:  ref,
			Label:        label,
		})
		if row.ResourceType == "github_repo" {
			var payload struct {
				URL string `json:"url"`
				Ref string `json:"ref,omitempty"`
			}
			if json.Unmarshal(row.ResourceRef, &payload) == nil && payload.URL != "" {
				repos = append(repos, RepoData{URL: payload.URL, Ref: strings.TrimSpace(payload.Ref)})
			}
		}
	}
	return resources, repos
}
