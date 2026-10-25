CREATE TABLE IF NOT EXISTS tank_character (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    revision INTEGER NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tank_character_revision (
    character_id UUID NOT NULL,
    revision INTEGER NOT NULL,
    workspace_id UUID NOT NULL,
    payload JSONB NOT NULL,
    PRIMARY KEY (character_id, revision)
);
CREATE TABLE IF NOT EXISTS tank_play_session (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS tank_request (
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    operation TEXT NOT NULL,
    request_id UUID NOT NULL,
    body_hash TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id, operation, request_id)
);
