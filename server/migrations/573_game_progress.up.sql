-- Personal, workspace-scoped game progress. The game client is authoritative
-- for its own runs; the server only merges monotonic achievements (stars,
-- best score, unlocked stages) so a stale device cannot roll another one back.
-- No foreign keys: workspace and user deletion sweep this table explicitly.
CREATE TABLE IF NOT EXISTS game_progress (
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    game TEXT NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id, game)
);
