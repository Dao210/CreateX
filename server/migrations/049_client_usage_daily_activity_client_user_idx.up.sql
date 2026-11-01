CREATE INDEX CONCURRENTLY IF NOT EXISTS client_usage_daily_activity_client_user_idx ON client_usage_daily USING btree (activity_date, client_type, user_id);
