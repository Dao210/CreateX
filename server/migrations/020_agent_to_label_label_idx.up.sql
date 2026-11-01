CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_to_label_label_idx ON agent_to_label USING btree (label_id);
