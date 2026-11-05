CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fish_publication_source ON fish_publication (workspace_id, user_id, fish_id);
