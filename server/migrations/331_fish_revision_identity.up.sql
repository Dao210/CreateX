CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fish_revision_identity ON fish_revision (workspace_id,fish_id,revision);
