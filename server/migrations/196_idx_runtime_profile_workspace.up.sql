CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_runtime_profile_workspace ON runtime_profile USING btree (workspace_id);
