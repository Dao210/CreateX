CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ctf_request_identity ON ctf_request (workspace_id,user_id,request_id);
