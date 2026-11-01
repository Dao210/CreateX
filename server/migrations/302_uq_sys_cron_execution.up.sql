CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_sys_cron_execution ON sys_cron_executions (job_name, scope_kind, scope_id, plan_time);
