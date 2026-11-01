CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS task_usage_task_id_provider_model_key ON task_usage (task_id, provider, model);
