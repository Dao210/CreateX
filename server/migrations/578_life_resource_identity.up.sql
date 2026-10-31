CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS life_resource_identity_idx ON life_resource (world_id, owner, kind);
