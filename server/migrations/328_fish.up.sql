CREATE TABLE IF NOT EXISTS fish_character (
 id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
 revision integer NOT NULL, archived boolean NOT NULL DEFAULT false,
 payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fish_revision (
 fish_id uuid NOT NULL, revision integer NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS fish_ocean (
 id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
 visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','world')),
 revision integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fish_resident (
 id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL, ocean_id uuid NOT NULL,
 fish_id uuid NOT NULL, revision integer NOT NULL DEFAULT 1, active boolean NOT NULL DEFAULT true, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS fish_request (
 workspace_id uuid NOT NULL, user_id uuid NOT NULL, operation text NOT NULL, request_id uuid NOT NULL,
 body_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
