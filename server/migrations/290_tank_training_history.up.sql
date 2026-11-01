CREATE INDEX CONCURRENTLY IF NOT EXISTS tank_training_history ON tank_training_run USING btree (workspace_id, user_id, started_at);
