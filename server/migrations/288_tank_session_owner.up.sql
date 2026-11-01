CREATE INDEX CONCURRENTLY IF NOT EXISTS tank_session_owner ON tank_play_session USING btree (workspace_id, user_id, expires_at);
