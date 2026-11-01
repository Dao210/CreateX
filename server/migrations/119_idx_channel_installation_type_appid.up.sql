CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_installation_type_appid ON channel_installation USING btree (channel_type, ((config ->> 'app_id'::text)));
