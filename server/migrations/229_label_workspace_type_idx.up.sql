CREATE INDEX CONCURRENTLY IF NOT EXISTS label_workspace_type_idx ON label USING btree (workspace_id, resource_type);
