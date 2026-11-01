CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS game_progress_pkey ON game_progress (workspace_id, user_id, game);
