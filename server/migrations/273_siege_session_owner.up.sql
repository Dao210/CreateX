CREATE INDEX CONCURRENTLY IF NOT EXISTS siege_session_owner ON siege_session USING btree (workspace_id, user_id, updated_at DESC);
