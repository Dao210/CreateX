package mcpadmin

import (
	"context"
	"encoding/json"
	"time"
)

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	ReadOnly    bool           `json:"readOnly"`
}
type Definition struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Endpoint        string `json:"endpoint"`
	ProtocolVersion string `json:"protocolVersion"`
	Tools           []Tool `json:"tools"`
}
type Policy struct {
	ServiceID     string     `json:"serviceId"`
	Enabled       bool       `json:"enabled"`
	DisabledTools []string   `json:"disabledTools"`
	Revision      int        `json:"revision"`
	UpdatedBy     string     `json:"updatedBy,omitempty"`
	UpdatedAt     *time.Time `json:"updatedAt,omitempty"`
}

func DefaultPolicy(id string) Policy {
	return Policy{ServiceID: id, Enabled: true, DisabledTools: []string{}}
}
func (p Policy) Allows(name string) bool {
	if !p.Enabled {
		return false
	}
	for _, disabled := range p.DisabledTools {
		if name == disabled {
			return false
		}
	}
	return true
}

type Stats struct {
	Calls        int64      `json:"calls"`
	Errors       int64      `json:"errors"`
	Blocked      int64      `json:"blocked"`
	AverageMS    float64    `json:"averageMs"`
	LastCalledAt *time.Time `json:"lastCalledAt,omitempty"`
}
type Overview struct {
	Definition
	Policy    Policy           `json:"policy"`
	Stats     Stats            `json:"stats"`
	ToolStats map[string]Stats `json:"toolStats"`
}
type PolicyInput struct {
	ExpectedRevision int      `json:"expectedRevision"`
	Enabled          *bool    `json:"enabled"`
	DisabledTools    []string `json:"disabledTools"`
}
type Call struct {
	ServiceID   string
	WorkspaceID string
	ActorID     string
	ToolName    string
	Outcome     string
	ErrorCode   string
	DurationMS  int64
}
type Controller interface {
	Policy(context.Context, string) (Policy, error)
	RecordCall(context.Context, Call) error
}
type Activity struct {
	ID            string          `json:"id"`
	ServiceID     string          `json:"serviceId"`
	WorkspaceID   string          `json:"workspaceId,omitempty"`
	WorkspaceName string          `json:"workspaceName"`
	WorkspaceSlug string          `json:"workspaceSlug"`
	ActorID       string          `json:"actorId"`
	ActorName     string          `json:"actorName"`
	ActorEmail    string          `json:"actorEmail"`
	Kind          string          `json:"kind"`
	ToolName      string          `json:"toolName"`
	Outcome       string          `json:"outcome"`
	ErrorCode     string          `json:"errorCode"`
	DurationMS    int64           `json:"durationMs"`
	Details       json.RawMessage `json:"details"`
	OccurredAt    time.Time       `json:"occurredAt"`
}
type ActivityPage struct {
	Items      []Activity `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}
