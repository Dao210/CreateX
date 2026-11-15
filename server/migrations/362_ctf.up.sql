CREATE TABLE IF NOT EXISTS ctf_strategy (
 id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
 revision integer NOT NULL, archived boolean NOT NULL DEFAULT false,
 payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ctf_revision (
 strategy_id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
 revision integer NOT NULL, published boolean NOT NULL DEFAULT false,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ctf_entry (
 workspace_id uuid NOT NULL, user_id uuid NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS ctf_batch (
 id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'running', total integer NOT NULL,
 error text NOT NULL DEFAULT '', published boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ctf_match (
 id uuid NOT NULL, workspace_id uuid NOT NULL, batch_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued', payload jsonb NOT NULL,
 result jsonb, lease_id uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ctf_request (
 workspace_id uuid NOT NULL, user_id uuid NOT NULL, request_id uuid NOT NULL,
 body_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ctf_leaderboard (
 workspace_id uuid NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
