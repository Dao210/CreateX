package main

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/auro-ai/auro/server/internal/cli"
)

const minShortIDPrefixLen = 4
const resolverListPageLimit = 50

type resolvedID struct {
	ID string
	// Display is a best-effort label for human-facing messages. It may equal
	// ID when resolution does not fetch display metadata from the server.
	Display string
}

type idCandidate struct {
	ID      string
	Display string
	Detail  string
}

func displayID(id string, full bool) string {
	if full {
		return id
	}
	return truncateID(id)
}

func normalizeUUIDPrefix(input string) (string, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return "", fmt.Errorf("id is required")
	}
	prefix := strings.ToLower(strings.ReplaceAll(trimmed, "-", ""))
	if len(prefix) < minShortIDPrefixLen {
		return "", fmt.Errorf("expected a full UUID or at least %d hex characters, got %q", minShortIDPrefixLen, input)
	}
	for _, r := range prefix {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return "", fmt.Errorf("expected a UUID prefix containing only hex characters, got %q", input)
		}
	}
	return prefix, nil
}

func compactUUID(id string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(id), "-", ""))
}

func resolveIDByPrefix(ctx context.Context, client *cli.APIClient, kind, input string, fetch func(context.Context, *cli.APIClient) ([]idCandidate, error)) (resolvedID, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return resolvedID{}, fmt.Errorf("%s id is required", kind)
	}
	if uuidRegexp.MatchString(trimmed) {
		return resolvedID{ID: trimmed, Display: trimmed}, nil
	}

	prefix, err := normalizeUUIDPrefix(trimmed)
	if err != nil {
		return resolvedID{}, fmt.Errorf("resolve %s: %w", kind, err)
	}

	candidates, err := fetch(ctx, client)
	if err != nil {
		return resolvedID{}, fmt.Errorf("resolve %s: %w", kind, err)
	}

	matches := make([]idCandidate, 0, 1)
	for _, c := range candidates {
		if c.ID == "" {
			continue
		}
		if strings.HasPrefix(compactUUID(c.ID), prefix) {
			matches = append(matches, c)
		}
	}

	switch len(matches) {
	case 0:
		return resolvedID{}, fmt.Errorf("no %s found matching id prefix %q; run the list command with --full-id to copy the full UUID", kind, input)
	case 1:
		display := matches[0].Display
		if display == "" {
			display = matches[0].ID
		}
		return resolvedID{ID: matches[0].ID, Display: display}, nil
	default:
		return resolvedID{}, ambiguousIDPrefixError(kind, input, matches)
	}
}

func ambiguousIDPrefixError(kind, input string, matches []idCandidate) error {
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].ID < matches[j].ID
	})
	parts := make([]string, 0, len(matches))
	for _, m := range matches {
		parts = append(parts, "  "+m.ID)
	}
	return fmt.Errorf("ambiguous %s id prefix %q; matches:\n%s\nUse more characters or run the list command with --full-id", kind, input, strings.Join(parts, "\n"))
}

func parsePositiveInt(input string) (int, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(input))
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func resolveAutopilotID(ctx context.Context, client *cli.APIClient, input string) (resolvedID, error) {
	return resolveIDByPrefix(ctx, client, "autopilot", input, fetchAutopilotCandidates)
}

func fetchAutopilotCandidates(ctx context.Context, client *cli.APIClient) ([]idCandidate, error) {
	if client.WorkspaceID == "" {
		return nil, fmt.Errorf("workspace_id is required to resolve autopilot id prefixes")
	}
	const limit = resolverListPageLimit
	candidates := []idCandidate{}
	seen := map[string]struct{}{}
	for offset := 0; ; {
		params := url.Values{}
		params.Set("workspace_id", client.WorkspaceID)
		params.Set("limit", strconv.Itoa(limit))
		if offset > 0 {
			params.Set("offset", strconv.Itoa(offset))
		}
		var resp struct {
			Autopilots []map[string]any `json:"autopilots"`
			Total      int              `json:"total"`
			HasMore    bool             `json:"has_more"`
		}
		if err := client.GetJSON(ctx, "/api/autopilots?"+params.Encode(), &resp); err != nil {
			return nil, err
		}
		added := 0
		for _, a := range resp.Autopilots {
			id := strVal(a, "id")
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			added++
			candidates = append(candidates, idCandidate{
				ID:      id,
				Display: strVal(a, "title"),
				Detail:  strVal(a, "status"),
			})
		}
		pageLen := len(resp.Autopilots)
		offset += pageLen
		if pageLen == 0 || added == 0 {
			break
		}
		if pageLen < limit {
			break
		}
		if resp.HasMore {
			continue
		}
		if resp.Total > 0 {
			if offset >= resp.Total {
				break
			}
			continue
		}
	}
	return candidates, nil
}

func resolveAutopilotTriggerID(ctx context.Context, client *cli.APIClient, autopilotID, input string) (resolvedID, error) {
	trimmed := strings.TrimSpace(input)
	if uuidRegexp.MatchString(trimmed) {
		return resolvedID{ID: trimmed, Display: trimmed}, nil
	}
	fetch := func(ctx context.Context, client *cli.APIClient) ([]idCandidate, error) {
		var resp map[string]any
		if err := client.GetJSON(ctx, "/api/autopilots/"+url.PathEscape(autopilotID), &resp); err != nil {
			return nil, err
		}
		triggersRaw, _ := resp["triggers"].([]any)
		candidates := make([]idCandidate, 0, len(triggersRaw))
		for _, raw := range triggersRaw {
			t, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			detail := strVal(t, "kind")
			if label := strVal(t, "label"); label != "" {
				detail = label
			}
			candidates = append(candidates, idCandidate{
				ID:      strVal(t, "id"),
				Display: strVal(t, "id"),
				Detail:  detail,
			})
		}
		return candidates, nil
	}
	return resolveIDByPrefix(ctx, client, "autopilot trigger", input, fetch)
}

func resolveLabelID(ctx context.Context, client *cli.APIClient, input, resourceType string) (resolvedID, error) {
	return resolveIDByPrefix(ctx, client, "label", input, func(ctx context.Context, client *cli.APIClient) ([]idCandidate, error) {
		return fetchLabelCandidates(ctx, client, resourceType)
	})
}

func fetchLabelCandidates(ctx context.Context, client *cli.APIClient, resourceType string) ([]idCandidate, error) {
	if client.WorkspaceID == "" {
		return nil, fmt.Errorf("workspace_id is required to resolve label id prefixes")
	}
	resourceTypes := []string{resourceType}
	if resourceType == "" {
		resourceTypes = []string{"issue", "skill"}
	}
	candidates := make([]idCandidate, 0)
	for _, candidateType := range resourceTypes {
		params := url.Values{"workspace_id": {client.WorkspaceID}, "resource_type": {candidateType}}
		var result map[string]any
		if err := client.GetJSON(ctx, "/api/labels?"+params.Encode(), &result); err != nil {
			return nil, err
		}
		labelsRaw, _ := result["labels"].([]any)
		for _, raw := range labelsRaw {
			l, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			candidates = append(candidates, idCandidate{
				ID:      strVal(l, "id"),
				Display: strVal(l, "name"),
				Detail:  strVal(l, "color"),
			})
		}
	}
	return candidates, nil
}

type actorDisplayLookup struct {
	ctx    context.Context
	client *cli.APIClient
	state  *actorDisplayLookupState
}

type actorDisplayLookupState struct {
	members       map[string]string
	agents        map[string]string
	membersLoaded bool
	agentsLoaded  bool
}

func loadActorDisplayLookup(ctx context.Context, client *cli.APIClient) actorDisplayLookup {
	return actorDisplayLookup{
		ctx:    ctx,
		client: client,
		state:  &actorDisplayLookupState{},
	}
}

func (l actorDisplayLookup) loadMembers() {
	if l.state == nil || l.state.membersLoaded {
		return
	}
	l.state.membersLoaded = true
	l.state.members = map[string]string{}
	if l.client == nil || l.client.WorkspaceID == "" {
		return
	}
	var members []map[string]any
	if err := l.client.GetJSON(l.ctx, "/api/workspaces/"+url.PathEscape(l.client.WorkspaceID)+"/members", &members); err == nil {
		for _, m := range members {
			if id := strVal(m, "user_id"); id != "" {
				l.state.members[id] = strVal(m, "name")
			}
		}
	}
}

func (l actorDisplayLookup) loadAgents() {
	if l.state == nil || l.state.agentsLoaded {
		return
	}
	l.state.agentsLoaded = true
	l.state.agents = map[string]string{}
	if l.client == nil || l.client.WorkspaceID == "" {
		return
	}
	var agents []map[string]any
	agentPath := "/api/agents?" + url.Values{"workspace_id": {l.client.WorkspaceID}}.Encode()
	if err := l.client.GetJSON(l.ctx, agentPath, &agents); err == nil {
		for _, a := range agents {
			if id := strVal(a, "id"); id != "" {
				l.state.agents[id] = strVal(a, "name")
			}
		}
	}
}

func (l actorDisplayLookup) actor(actorType, id string) string {
	if actorType == "" || id == "" {
		return ""
	}
	switch actorType {
	case "member":
		l.loadMembers()
		if l.state != nil && l.state.members != nil {
			if name := l.state.members[id]; name != "" {
				return "member:" + name
			}
		}
	case "agent":
		l.loadAgents()
		if l.state != nil && l.state.agents != nil {
			if name := l.state.agents[id]; name != "" {
				return "agent:" + name
			}
		}

	}
	return actorType + ":" + id
}

func (l actorDisplayLookup) agent(id string) string {
	if id == "" {
		return ""
	}
	l.loadAgents()
	if l.state != nil && l.state.agents != nil {
		if name := l.state.agents[id]; name != "" {
			return name
		}
	}
	return id
}
