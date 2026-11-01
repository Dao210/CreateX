CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS workspace_share_link_active_ws_uidx ON workspace_share_link USING btree (workspace_id) WHERE (is_active = true);
