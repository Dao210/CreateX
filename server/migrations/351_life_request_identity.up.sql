CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_request_identity ON life_request(world_id,user_id,request_id);
