CREATE TABLE IF NOT EXISTS fish_exploration_state (
    resident_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    state jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS fish_exploration_clock (
    id integer NOT NULL CHECK (id = 1),
    tick bigint NOT NULL,
    last_tick timestamptz NOT NULL
);
