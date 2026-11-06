DROP TRIGGER IF EXISTS world_ops_release ON fish_request;
DROP TRIGGER IF EXISTS world_ops_progress ON game_progress;
DROP FUNCTION IF EXISTS world_ops_capture_release();
DROP FUNCTION IF EXISTS world_ops_capture_progress();
DROP VIEW IF EXISTS world_ops_creation;
DELETE FROM world_ops_coverage;
