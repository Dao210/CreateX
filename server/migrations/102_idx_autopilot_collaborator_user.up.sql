CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_collaborator_user ON autopilot_collaborator USING btree (user_type, user_id);
