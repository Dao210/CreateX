CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_dingtalk_bot_identity_installation ON dingtalk_bot_identity USING btree (installation_id);
