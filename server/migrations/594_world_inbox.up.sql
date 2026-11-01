ALTER TABLE inbox_item ADD COLUMN IF NOT EXISTS content JSONB;

-- Business facts are committed with their source mutation. Delivery and hourly
-- summaries consume them independently and never rewrite a published summary.
CREATE TABLE world_inbox_event (
    id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('tank_created', 'tank_updated', 'tank_level_up')),
    content JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    delivered_at TIMESTAMPTZ,
    summarized_at TIMESTAMPTZ
);
