CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_sales_inquiry_created ON contact_sales_inquiry USING btree (created_at DESC);
