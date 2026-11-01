CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dingtalk_group_route_workspace ON dingtalk_group_route USING btree (workspace_id);
