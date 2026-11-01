CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seat_capacity_outbox_due ON seat_capacity_outbox USING btree (next_attempt_at, created_at) WHERE (dead_lettered_at IS NULL);
