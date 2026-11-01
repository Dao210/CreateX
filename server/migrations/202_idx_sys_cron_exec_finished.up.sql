CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sys_cron_exec_finished ON sys_cron_executions USING btree (finished_at) WHERE (status = ANY (ARRAY['SUCCESS'::text, 'FAILED'::text]));
