CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sys_cron_exec_failed_recent ON sys_cron_executions USING btree (job_name, plan_time DESC) WHERE (status = 'FAILED'::text);
