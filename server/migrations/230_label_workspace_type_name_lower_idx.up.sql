CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS label_workspace_type_name_lower_idx ON label USING btree (workspace_id, resource_type, lower(name));
