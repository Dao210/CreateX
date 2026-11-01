CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_maintenance_job_active ON maintenance_job USING btree (job_type, scope_key) WHERE (status = ANY (ARRAY['ready'::text, 'paused'::text]));
