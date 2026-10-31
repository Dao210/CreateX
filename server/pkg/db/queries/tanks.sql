-- name: ListTankCharacters :many
SELECT payload, experience FROM tank_character WHERE workspace_id = $1 AND (NOT sqlc.arg(mine)::boolean OR user_id = sqlc.arg(user_id)) ORDER BY updated_at DESC, id;

-- name: GetTankCharacter :one
SELECT * FROM tank_character WHERE workspace_id = $1 AND id = $2;

-- name: GetTankCharacterRevision :one
SELECT payload FROM tank_character_revision WHERE workspace_id = $1 AND character_id = $2 AND revision = $3;

-- name: PutTankCharacter :exec
INSERT INTO tank_character (id, workspace_id, user_id, revision, payload)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, payload = EXCLUDED.payload, updated_at = now()
WHERE tank_character.workspace_id = EXCLUDED.workspace_id AND tank_character.user_id = EXCLUDED.user_id;

-- name: InsertTankCharacterRevision :exec
INSERT INTO tank_character_revision (character_id, revision, workspace_id, payload) VALUES ($1, $2, $3, $4);

-- name: CountTankCharacters :one
SELECT count(*) FROM tank_character WHERE workspace_id = $1;

-- name: InsertTankPlaySession :exec
INSERT INTO tank_play_session (id, workspace_id, user_id, payload, expires_at) VALUES ($1, $2, $3, $4, $5);

-- name: GetTankPlaySession :one
SELECT payload FROM tank_play_session WHERE workspace_id = $1 AND user_id = $2 AND id = $3;

-- name: CountTankPlaySessions :one
SELECT count(*) FROM tank_play_session WHERE workspace_id = $1 AND user_id = $2 AND expires_at > now();

-- name: GetTankRequest :one
SELECT body_hash, response FROM tank_request WHERE workspace_id = $1 AND user_id = $2 AND operation = $3 AND request_id = $4;

-- name: InsertTankRequest :exec
INSERT INTO tank_request (workspace_id, user_id, operation, request_id, body_hash, response) VALUES ($1, $2, $3, $4, $5, $6);

-- name: PruneTankRequests :exec
DELETE FROM tank_request WHERE workspace_id = $1 AND created_at < now() - interval '7 days';

-- name: PruneTankSessions :exec
DELETE FROM tank_play_session WHERE workspace_id = $1 AND expires_at < now() - interval '7 days';

-- name: GetTankTrainingRun :one
SELECT * FROM tank_training_run WHERE workspace_id = $1 AND user_id = $2 AND id = $3 FOR UPDATE;

-- name: InsertTankTrainingRun :exec
INSERT INTO tank_training_run (id, workspace_id, user_id, session_id, character_id, level_id) VALUES ($1, $2, $3, $4, $5, $6);

-- name: CancelActiveTankTraining :exec
UPDATE tank_training_run SET settled_at = now() WHERE workspace_id = $1 AND user_id = $2 AND settled_at IS NULL;

-- name: PruneTankTraining :exec
DELETE FROM tank_training_run WHERE workspace_id = $1 AND user_id = $2 AND started_at < now() - interval '7 days';

-- name: CountRecentTankTraining :one
SELECT count(*) FROM tank_training_run WHERE workspace_id = $1 AND user_id = $2 AND started_at > now() - interval '1 day';

-- name: AddTankExperience :one
UPDATE tank_character SET experience = LEAST(experience + sqlc.arg(award)::integer, sqlc.arg(max_experience)::integer)
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id) AND id = sqlc.arg(id)
RETURNING experience;

-- name: SettleTankTrainingRun :exec
UPDATE tank_training_run SET settled_at = now(), body_hash = $4, result = $5 WHERE workspace_id = $1 AND user_id = $2 AND id = $3;
