CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_autopilot_run_quota_reservation ON autopilot_run USING btree (quota_reservation_id) WHERE (quota_reservation_id IS NOT NULL);
