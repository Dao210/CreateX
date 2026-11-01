CREATE INDEX CONCURRENTLY IF NOT EXISTS skill_to_label_label_idx ON skill_to_label USING btree (label_id);
