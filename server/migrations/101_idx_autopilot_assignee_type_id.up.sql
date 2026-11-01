CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_assignee_type_id ON autopilot USING btree (assignee_type, assignee_id);
