CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS vcs_connection_workspace_id_instance_url_key ON vcs_connection (workspace_id, instance_url);
