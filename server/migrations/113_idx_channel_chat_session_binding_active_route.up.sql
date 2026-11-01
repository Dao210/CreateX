CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_channel_chat_session_binding_active_route ON channel_chat_session_binding USING btree (installation_id, channel_chat_id) WHERE (retired_at IS NULL);
