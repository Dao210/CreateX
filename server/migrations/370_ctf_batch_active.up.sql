CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ctf_batch_active ON ctf_batch (workspace_id) WHERE status IN ('running','paused');
