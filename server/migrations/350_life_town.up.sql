ALTER TABLE life_world ADD COLUMN IF NOT EXISTS town jsonb NOT NULL DEFAULT 'null'::jsonb;

CREATE TABLE IF NOT EXISTS life_request (
 world_id uuid NOT NULL,
 user_id uuid NOT NULL,
 request_id uuid NOT NULL,
 body_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
