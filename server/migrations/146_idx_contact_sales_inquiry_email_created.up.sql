CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_sales_inquiry_email_created ON contact_sales_inquiry USING btree (business_email, created_at DESC);
