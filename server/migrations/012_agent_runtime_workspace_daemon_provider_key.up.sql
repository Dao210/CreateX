CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS agent_runtime_workspace_daemon_provider_key ON agent_runtime USING btree (workspace_id, daemon_id, provider) WHERE (profile_id IS NULL);
