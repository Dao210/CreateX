CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS client_usage_daily_pkey ON client_usage_daily (user_id, client_type, install_id, activity_date);
