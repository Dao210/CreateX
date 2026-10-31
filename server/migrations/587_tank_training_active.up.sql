CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tank_training_active ON tank_training_run (workspace_id, user_id) WHERE settled_at IS NULL;
