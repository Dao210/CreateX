CREATE INDEX CONCURRENTLY IF NOT EXISTS world_ops_visit_date ON world_ops_visit (visit_day, workspace_id, user_id);
