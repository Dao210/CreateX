CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS github_installation_workspace_id_installation_id_key ON github_installation (workspace_id, installation_id);
