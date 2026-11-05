CREATE TABLE IF NOT EXISTS fish_publication (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    fish_id uuid NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    active boolean NOT NULL DEFAULT true,
    payload jsonb NOT NULL
);
