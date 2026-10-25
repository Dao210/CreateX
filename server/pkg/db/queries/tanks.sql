-- name: ListTankCharacters :many
SELECT payload FROM tank_character WHERE workspace_id = $1 ORDER BY updated_at DESC, id;

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
