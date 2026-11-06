CREATE TABLE world_ops_visit (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    visit_day date NOT NULL,
    first_seen_at timestamptz NOT NULL
);

CREATE TABLE world_ops_action (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    game text NOT NULL,
    kind text NOT NULL,
    origin text NOT NULL,
    occurred_at timestamptz NOT NULL
);

CREATE TABLE world_ops_followup (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    assignee_id uuid NOT NULL,
    reason text NOT NULL,
    due_on date,
    version integer NOT NULL DEFAULT 1,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE world_ops_followup_entry (
    workspace_id uuid NOT NULL,
    followup_id uuid NOT NULL,
    version integer NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    assignee_id uuid NOT NULL,
    due_on date,
    note text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE world_ops_coverage (
    started_at timestamptz NOT NULL
);
