ALTER TABLE tank_character ADD COLUMN IF NOT EXISTS experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0 AND experience <= 2700);
CREATE TABLE IF NOT EXISTS tank_training_run (
    id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    session_id UUID NOT NULL,
    character_id UUID NOT NULL,
    level_id INTEGER NOT NULL CHECK (level_id BETWEEN 1 AND 6),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ,
    body_hash TEXT,
    result JSONB
);
