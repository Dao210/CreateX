CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_autopilot_quota_reservation_state ON autopilot_quota_reservation USING btree (state, created_at) WHERE (state = 'reserved'::text);
