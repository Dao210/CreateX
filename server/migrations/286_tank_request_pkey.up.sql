CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tank_request_pkey ON tank_request (workspace_id, user_id, operation, request_id);
