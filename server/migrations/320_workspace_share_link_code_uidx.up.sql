CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS workspace_share_link_code_uidx ON workspace_share_link USING btree (code);
