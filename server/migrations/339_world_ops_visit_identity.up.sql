CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS world_ops_visit_identity ON world_ops_visit (workspace_id, visit_day, user_id);
