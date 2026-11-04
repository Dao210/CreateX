CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fish_request_identity ON fish_request (workspace_id,user_id,operation,request_id);
