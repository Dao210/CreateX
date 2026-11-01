CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbox_recipient ON inbox_item USING btree (recipient_type, recipient_id, read);
