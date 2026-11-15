CREATE INDEX CONCURRENTLY IF NOT EXISTS ctf_match_queue ON ctf_match (status,lease_until,created_at);
