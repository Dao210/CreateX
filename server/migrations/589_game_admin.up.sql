CREATE TABLE IF NOT EXISTS game_policy (
    game_id TEXT NOT NULL CHECK (game_id IN ('siege', 'tanks', 'life')),
    scope TEXT NOT NULL CHECK (scope IN ('all', 'selected', 'bound', 'disabled')),
    default_visible BOOLEAN NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_by UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game_world_override (
    game_id TEXT NOT NULL CHECK (game_id IN ('siege', 'tanks', 'life')),
    workspace_id UUID NOT NULL,
    access TEXT NOT NULL CHECK (access IN ('inherit', 'allow', 'deny')),
    visibility TEXT NOT NULL CHECK (visibility IN ('inherit', 'show', 'hide'))
);
CREATE TABLE IF NOT EXISTS game_policy_audit (
    game_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    actor_id UUID NOT NULL,
    previous JSONB NOT NULL,
    current JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
