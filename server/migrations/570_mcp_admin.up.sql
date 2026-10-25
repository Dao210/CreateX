CREATE TABLE IF NOT EXISTS mcp_service_policy (
    service_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    disabled_tools TEXT[] NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL,
    updated_by UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_activity (
    id UUID PRIMARY KEY,
    service_id TEXT NOT NULL,
    workspace_id UUID,
    actor_id UUID NOT NULL,
    kind TEXT NOT NULL,
    tool_name TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL,
    error_code TEXT NOT NULL DEFAULT '',
    duration_ms BIGINT NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
