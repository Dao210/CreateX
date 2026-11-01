CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_dingtalk_group_route_installation_conversation ON dingtalk_group_route USING btree (installation_id, conversation_id);
