CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS autopilot_quota_period_pkey ON autopilot_quota_period (workspace_id, period_start, period_end);
