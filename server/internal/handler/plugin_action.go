package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/auro-ai/auro/server/internal/middleware"
	"github.com/auro-ai/auro/server/internal/service"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/auro-ai/auro/server/pkg/plugincontract"
	publicapiv1 "github.com/auro-ai/auro/server/pkg/publicapi/v1"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// The Action API is what a plugin surface reaches through the host bridge.
//
// Every call passes three checks, in this order:
//
//  1. the installation exists in this workspace and is enabled;
//  2. the installation was granted the scope this endpoint needs;
//  3. the SIGNED-IN USER may touch the resource — enforced by the ordinary
//     loaders, not by anything plugin-specific.
//
// Three is the one that makes the whole model safe: a plugin can never let
// someone do what they could not already do themselves. One and two are what
// bound the plugin below that ceiling.
//
// A SURFACE still holds no credential. The iframe posts a message to the host
// page, and the host re-issues the call on the user's own session, reading the
// installation from a header the iframe cannot set for itself.
//
// Hooks add a second kind of caller: a plugin's own server, which has no
// session and never will. It presents a bearer token instead, and that changes
// only WHO the call acts as — the three checks above are the same either way.
// See pluginActor for how identity is decided.
const pluginInstallationHeader = "X-Auro-Plugin-Installation"

// pluginActor is who a call acts as, and it is decided by how the caller
// authenticated rather than by anything the caller asks for.
//
//	session, or a callback token from a ui/manual hook
//	    -> the person. Writes are theirs, marked with via_plugin_id.
//	install token, or a callback token from an event hook
//	    -> the installation. Writes are the plugin's own.
//
// The second case is why author_type gained a 'plugin' value: an event hook has
// no person behind it, and attributing its writes to the last member who
// happened to touch the issue would be a lie that the audit trail cannot undo.
type pluginActor struct {
	Type string
	// Member is present only when Type is "member". A plugin-actor call has no
	// member row to check permissions against, which is exactly why the
	// endpoints that need one refuse it.
	Member db.Member
}

func (a pluginActor) isMember() bool { return a.Type == "member" }

// requireMember refuses an endpoint that has no meaning without a person.
func (a pluginActor) requireMember(w http.ResponseWriter, r *http.Request) bool {
	if a.isMember() {
		return true
	}
	publicapiv1.WriteProblem(w, r, http.StatusForbidden, "member_required", "this endpoint requires a user; the presented token acts as the Plugin itself")
	return false
}

func (h *Handler) requirePluginActionV1(w http.ResponseWriter, r *http.Request) bool {
	if h.pluginsV1Enabled(r.Context()) {
		return true
	}
	publicapiv1.WriteProblem(w, r, http.StatusForbidden, "plugin_api_disabled", "Plugin management is not enabled")
	return false
}

// writePluginActionError maps service-layer failures into the one stable
// Public API problem contract. Management endpoints intentionally keep their
// existing App API errors; only the versioned Action/bridge surface uses this.
func writePluginActionError(w http.ResponseWriter, r *http.Request, err error, fallback string) {
	var pluginErr *service.PluginError
	if !errors.As(err, &pluginErr) {
		publicapiv1.WriteProblem(w, r, http.StatusInternalServerError, "internal_error", fallback)
		return
	}
	switch pluginErr.Kind {
	case service.PluginErrorInvalid:
		publicapiv1.WriteProblem(w, r, http.StatusBadRequest, "invalid_request", pluginErr.Message)
	case service.PluginErrorNotFound:
		publicapiv1.WriteProblem(w, r, http.StatusNotFound, "not_found", pluginErr.Message)
	case service.PluginErrorConflict:
		publicapiv1.WriteProblem(w, r, http.StatusConflict, "conflict", pluginErr.Message)
	case service.PluginErrorForbidden:
		publicapiv1.WriteProblem(w, r, http.StatusForbidden, "forbidden", pluginErr.Message)
	case service.PluginErrorIncompatible:
		publicapiv1.WriteProblem(w, r, http.StatusUnprocessableEntity, "incompatible", pluginErr.Message)
	case service.PluginErrorQuota:
		publicapiv1.WriteProblem(w, r, http.StatusInsufficientStorage, "quota_exceeded", pluginErr.Message)
	default:
		publicapiv1.WriteProblem(w, r, http.StatusBadGateway, "upstream_unavailable", pluginErr.Message)
	}
}

// pluginCaller runs checks 1 and 2 and returns the authorized caller.
func (h *Handler) pluginCaller(w http.ResponseWriter, r *http.Request, scope string) (service.PluginActionCaller, pluginActor, bool) {
	if !h.requirePluginActionV1(w, r) {
		return service.PluginActionCaller{}, pluginActor{}, false
	}
	if token := middleware.BearerToken(r); middleware.IsPluginBearerToken(token) {
		return h.pluginTokenCaller(w, r, token, scope)
	}
	return h.pluginSessionCaller(w, r, scope)
}

// pluginSessionCaller is the surface path, unchanged: a real signed-in user
// whose own permissions bound everything the plugin can reach.
func (h *Handler) pluginSessionCaller(w http.ResponseWriter, r *http.Request, scope string) (service.PluginActionCaller, pluginActor, bool) {
	userID := strings.TrimSpace(r.Header.Get("X-User-ID"))
	if userID == "" {
		publicapiv1.WriteProblem(w, r, http.StatusUnauthorized, "unauthorized", "missing authenticated user")
		return service.PluginActionCaller{}, pluginActor{}, false
	}
	parsedUserID, err := util.ParseUUID(userID)
	if err != nil {
		publicapiv1.WriteProblem(w, r, http.StatusBadRequest, "invalid_request", "user_id must be a valid UUID")
		return service.PluginActionCaller{}, pluginActor{}, false
	}

	caller, err := h.PluginService.AuthorizePluginAction(r.Context(), r.Header.Get(pluginInstallationHeader), parsedUserID, scope)
	if err != nil {
		writePluginActionError(w, r, err, "failed to authorize the Plugin call")
		return service.PluginActionCaller{}, pluginActor{}, false
	}

	// The workspace comes from the installation, never from a client header:
	// otherwise a caller could aim an installation at a workspace it was never
	// installed in. Membership is then checked against that workspace.
	member, err := h.getWorkspaceMember(r.Context(), userID, uuidToString(caller.WorkspaceID))
	if err != nil {
		publicapiv1.WriteProblem(w, r, http.StatusNotFound, "not_found", "workspace not found")
		return service.PluginActionCaller{}, pluginActor{}, false
	}
	return caller, pluginActor{Type: "member", Member: member}, true
}

// pluginTokenCaller is the hook path: a plugin's own server calling in.
//
// A callback token is scoped to one INVOCATION, lives for minutes, and carries
// the actor decided when the hook went out — so a ui-triggered hook writes back
// as the person who pressed the button and cannot elect to write as anyone
// else. An install token is standing access and always acts as the plugin.
func (h *Handler) pluginTokenCaller(w http.ResponseWriter, r *http.Request, token, scope string) (service.PluginActionCaller, pluginActor, bool) {
	var installationID pgtype.UUID
	actor := pluginActor{Type: "plugin"}
	var memberUserID pgtype.UUID
	var issueScope pgtype.UUID

	switch {
	case strings.HasPrefix(token, "mpc_"):
		if h.PluginService.Callbacks == nil {
			publicapiv1.WriteProblem(w, r, http.StatusForbidden, "callback_tokens_disabled", "callback tokens are not enabled")
			return service.PluginActionCaller{}, pluginActor{}, false
		}
		grant, err := h.PluginService.Callbacks.Resolve(token)
		if err != nil {
			writePluginActionError(w, r, err, "failed to authorize the Plugin call")
			return service.PluginActionCaller{}, pluginActor{}, false
		}
		installationID = grant.InstallationID
		issueScope = grant.IssueID
		if grant.Actor.Type == "member" {
			memberUserID = grant.Actor.ID
		}
	default:
		installation, err := h.PluginService.AuthenticateInstallToken(r.Context(), token)
		if err != nil {
			writePluginActionError(w, r, err, "failed to authorize the Plugin call")
			return service.PluginActionCaller{}, pluginActor{}, false
		}
		installationID = installation.ID
	}

	caller, err := h.PluginService.AuthorizePluginAction(r.Context(), uuidToString(installationID), memberUserID, scope)
	if err != nil {
		writePluginActionError(w, r, err, "failed to authorize the Plugin call")
		return service.PluginActionCaller{}, pluginActor{}, false
	}

	// The grant said which issue it was about. Carrying it here is what turns
	// that from a comment into a check — see pluginIssueForUser.
	caller.IssueScope = issueScope

	// A callback token that stands for a person is only as good as that
	// person's membership TODAY. Re-checking here means revoking someone's
	// access takes effect on a token already in flight.
	if memberUserID.Valid {
		member, err := h.getWorkspaceMember(r.Context(), uuidToString(memberUserID), uuidToString(caller.WorkspaceID))
		if err != nil {
			publicapiv1.WriteProblem(w, r, http.StatusForbidden, "actor_membership_revoked", "the user this callback acts for is no longer a member")
			return service.PluginActionCaller{}, pluginActor{}, false
		}
		actor = pluginActor{Type: "member", Member: member}
	}
	return caller, actor, true
}

// pluginIssueForUser is check 3. The workspace comes from the installation, not
// from a client header, and membership in that workspace was already verified
// by pluginCaller — so "the issue is in this workspace" plus "the caller is a
// member of it" is exactly the reach the user already has. An issue outside it
// is a 404 for the same reason it is on the ordinary endpoint: a plugin must
// not be able to confirm that an id it cannot read exists.
func (h *Handler) pluginIssueForUser(w http.ResponseWriter, r *http.Request, caller service.PluginActionCaller, issueID string) (db.Issue, bool) {
	if issueID == "" {
		publicapiv1.WriteProblem(w, r, http.StatusNotFound, "not_found", "issue not found")
		return db.Issue{}, false
	}
	// Resolve first, then compare ids: a caller may name an issue by identifier
	// (PLUG-12) or by uuid, and comparing raw strings would let the same issue
	// pass under one spelling and fail under the other.
	issue, ok := h.resolvePluginIssue(r, caller, issueID)
	if !ok {
		publicapiv1.WriteProblem(w, r, http.StatusNotFound, "not_found", "issue not found")
		return db.Issue{}, false
	}
	// A callback grant issued about one issue reaches only that issue. Without
	// this the grant is worth every issue in the workspace its actor can see,
	// for the whole five minutes it lives.
	//
	// 404 rather than 403: the caller may well be able to see this issue by
	// other means, and "you are scoped elsewhere" would confirm the id exists.
	if caller.IssueScope.Valid && uuidToString(issue.ID) != uuidToString(caller.IssueScope) {
		publicapiv1.WriteProblem(w, r, http.StatusNotFound, "not_found", "issue not found")
		return db.Issue{}, false
	}
	return issue, true
}

// resolvePluginIssue finds an issue inside the caller's workspace, by
// identifier or by uuid. Membership in that workspace was established by
// pluginCaller, so this is exactly the reach the caller already has.
func (h *Handler) resolvePluginIssue(r *http.Request, caller service.PluginActionCaller, issueID string) (db.Issue, bool) {
	workspaceID := uuidToString(caller.WorkspaceID)
	if issue, ok := h.resolveIssueByIdentifier(r.Context(), issueID, workspaceID); ok {
		return issue, true
	}
	parsed, err := util.ParseUUID(issueID)
	if err != nil {
		return db.Issue{}, false
	}
	issue, err := h.Queries.GetIssueInWorkspace(r.Context(), db.GetIssueInWorkspaceParams{
		ID:          parsed,
		WorkspaceID: caller.WorkspaceID,
	})
	if err != nil {
		return db.Issue{}, false
	}
	return issue, true
}

// GetPluginContext — GET /v1/context
func (h *Handler) GetPluginContext(w http.ResponseWriter, r *http.Request) {
	// No scope: this is the page the user is already looking at.
	caller, actor, ok := h.pluginCaller(w, r, "")
	if !ok {
		return
	}
	workspace, err := h.Queries.GetWorkspace(r.Context(), caller.WorkspaceID)
	if err != nil {
		publicapiv1.WriteProblem(w, r, http.StatusInternalServerError, "internal_error", "failed to load the workspace")
		return
	}
	// A plugin-actor call has no user to describe, and the payload says so
	// rather than presenting an empty one that a handler might read as real.
	var user *db.User
	if actor.isMember() {
		loaded, err := h.Queries.GetUser(r.Context(), actor.Member.UserID)
		if err != nil {
			publicapiv1.WriteProblem(w, r, http.StatusInternalServerError, "internal_error", "failed to load the user")
			return
		}
		user = &loaded
	}

	var issue *db.Issue
	if issueID := r.URL.Query().Get("issue_id"); issueID != "" {
		loaded, ok := h.pluginIssueForUser(w, r, caller, issueID)
		if !ok {
			return
		}
		issue = &loaded
	}

	writeJSON(w, http.StatusOK, publicPluginContext(h.PluginService.BuildPluginContext(caller, workspace, user, issue)))
}

func publicPluginContext(context service.PluginContext) publicapiv1.Context {
	payload := publicapiv1.Context{
		Workspace: publicapiv1.ContextWorkspace{
			ID:   context.Workspace.ID,
			Name: context.Workspace.Name,
			Slug: context.Workspace.Slug,
		},
		Config:            context.Config,
		GrantedNetDomains: context.GrantedURLs,
		Actor:             context.Actor,
	}
	if context.User != nil {
		payload.User = &publicapiv1.ContextUser{ID: context.User.ID, Name: context.User.Name}
	}
	if context.Issue != nil {
		payload.Issue = &publicapiv1.ContextIssue{
			ID:         context.Issue.ID,
			Identifier: context.Issue.Identifier,
			Title:      context.Issue.Title,
		}
	}
	return payload
}

// --- Storage ---

func (h *Handler) pluginStorageScope(w http.ResponseWriter, r *http.Request, caller service.PluginActionCaller, actor pluginActor) (string, pgtype.UUID, bool) {
	scopeType := chi.URLParam(r, "scope")
	required := plugincontract.ScopeStorageWorkspace
	if scopeType == service.PluginStorageUser {
		required = plugincontract.ScopeStorageUser
	}
	if !hasGrantedScope(caller.Scopes, required) {
		publicapiv1.WriteProblem(w, r, http.StatusForbidden, "missing_scope", "this Plugin was not granted the "+required+" scope")
		return "", pgtype.UUID{}, false
	}
	// storage:user is per-member state, so a caller with no member has no such
	// scope to resolve. Falling through would key every plugin-actor write to
	// the zero UUID — one shared bucket masquerading as somebody's private one.
	if scopeType == service.PluginStorageUser && !actor.requireMember(w, r) {
		return "", pgtype.UUID{}, false
	}
	scopeID, err := service.ResolveStorageScope(scopeType, caller.WorkspaceID, actor.Member.UserID)
	if err != nil {
		writePluginActionError(w, r, err, "invalid storage scope")
		return "", pgtype.UUID{}, false
	}
	return scopeType, scopeID, true
}

func hasGrantedScope(scopes []string, want string) bool {
	for _, scope := range scopes {
		if scope == want {
			return true
		}
	}
	return false
}

// ListPluginStorage — GET /v1/storage/{scope}
func (h *Handler) ListPluginStorage(w http.ResponseWriter, r *http.Request) {
	caller, actor, ok := h.pluginCaller(w, r, "")
	if !ok {
		return
	}
	scopeType, scopeID, ok := h.pluginStorageScope(w, r, caller, actor)
	if !ok {
		return
	}
	keys, err := h.PluginService.ListStorageKeys(r.Context(), caller.Installation.ID, scopeType, scopeID)
	if err != nil {
		writePluginActionError(w, r, err, "failed to list storage")
		return
	}
	payload := make([]publicapiv1.StorageKey, 0, len(keys))
	for _, key := range keys {
		payload = append(payload, publicapiv1.StorageKey{
			Key: key.Key, SizeBytes: key.SizeBytes, UpdatedAt: key.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, publicapiv1.StorageKeyListResponse{Keys: payload})
}

// GetPluginStorage — GET /v1/storage/{scope}/{key}
func (h *Handler) GetPluginStorage(w http.ResponseWriter, r *http.Request) {
	caller, actor, ok := h.pluginCaller(w, r, "")
	if !ok {
		return
	}
	scopeType, scopeID, ok := h.pluginStorageScope(w, r, caller, actor)
	if !ok {
		return
	}
	value, err := h.PluginService.GetStorageValue(r.Context(), caller.Installation.ID, scopeType, scopeID, chi.URLParam(r, "key"))
	if err != nil {
		writePluginActionError(w, r, err, "failed to read storage")
		return
	}
	writeJSON(w, http.StatusOK, publicapiv1.StorageValueResponse{Value: value})
}

// PutPluginStorage — PUT /v1/storage/{scope}/{key}
func (h *Handler) PutPluginStorage(w http.ResponseWriter, r *http.Request) {
	caller, actor, ok := h.pluginCaller(w, r, "")
	if !ok {
		return
	}
	scopeType, scopeID, ok := h.pluginStorageScope(w, r, caller, actor)
	if !ok {
		return
	}
	var req publicapiv1.PutStorageValueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		publicapiv1.WriteProblem(w, r, http.StatusBadRequest, "invalid_request", "invalid request body")
		return
	}
	if err := h.PluginService.SetStorageValue(r.Context(), caller.Installation.ID, scopeType, scopeID, chi.URLParam(r, "key"), req.Value); err != nil {
		writePluginActionError(w, r, err, "failed to write storage")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeletePluginStorage — DELETE /v1/storage/{scope}/{key}
func (h *Handler) DeletePluginStorage(w http.ResponseWriter, r *http.Request) {
	caller, actor, ok := h.pluginCaller(w, r, "")
	if !ok {
		return
	}
	scopeType, scopeID, ok := h.pluginStorageScope(w, r, caller, actor)
	if !ok {
		return
	}
	if err := h.PluginService.DeleteStorageValue(r.Context(), caller.Installation.ID, scopeType, scopeID, chi.URLParam(r, "key")); err != nil {
		writePluginActionError(w, r, err, "failed to delete storage")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
