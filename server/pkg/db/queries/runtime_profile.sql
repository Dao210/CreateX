-- name: CreateRuntimeProfile :one
INSERT INTO runtime_profile (
    workspace_id,
    display_name,
    protocol_family,
    command_name,
    description,
    fixed_args,
    visibility,
    created_by,
    enabled,
    runtime_type
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;





-- name: GetRuntimeProfile :one
SELECT * FROM runtime_profile
WHERE id = $1;





-- name: GetRuntimeProfileForWorkspace :one
SELECT * FROM runtime_profile
WHERE id = $1 AND workspace_id = $2;





-- name: LockRuntimeProfileForRegistration :one
SELECT * FROM runtime_profile
WHERE id = $1 AND workspace_id = $2
FOR KEY SHARE;





-- name: LockRuntimeProfileForDelete :one
SELECT * FROM runtime_profile
WHERE id = $1 AND workspace_id = $2
FOR UPDATE;





-- name: ListRuntimeProfiles :many
SELECT * FROM runtime_profile
WHERE workspace_id = $1
ORDER BY created_at ASC;





-- name: ListEnabledRuntimeProfilesForWorkspace :many
SELECT * FROM runtime_profile
WHERE workspace_id = $1 AND enabled = true
ORDER BY created_at ASC;





-- name: UpdateRuntimeProfile :one
UPDATE runtime_profile
SET display_name = COALESCE(sqlc.narg('display_name'), display_name),
    command_name = COALESCE(sqlc.narg('command_name'), command_name),
    description  = COALESCE(sqlc.narg('description'), description),
    fixed_args   = COALESCE(sqlc.narg('fixed_args'), fixed_args),
    visibility   = COALESCE(sqlc.narg('visibility'), visibility),
    enabled      = COALESCE(sqlc.narg('enabled'), enabled),
    updated_at   = now()
WHERE id = @id AND workspace_id = @workspace_id
RETURNING *;





-- name: DeleteRuntimeProfile :exec
DELETE FROM runtime_profile
WHERE id = $1 AND workspace_id = $2;





-- name: DeleteAgentRuntimesByProfile :many
DELETE FROM agent_runtime
WHERE profile_id = $1 AND workspace_id = $2
RETURNING id, workspace_id, owner_id, daemon_id, provider;





-- name: ListActiveAgentsByProfile :many
WITH blockers AS (
    SELECT
        a.id,
        a.name,
        a.kind,
        a.system_key,
        ar.id AS runtime_id,
        ar.name AS runtime_name,
        ar.custom_name AS runtime_custom_name,
        ar.status AS runtime_status,
        CASE
            WHEN a.system_key IS NULL OR btrim(a.system_key) = '' THEN 'user'
            WHEN btrim(a.system_key) = 'mika' THEN 'mika'
            WHEN starts_with(btrim(a.system_key), 'agent_builder:') THEN 'agent_builder'
            ELSE 'other_system'
        END AS blocker_class
    FROM agent a
    JOIN agent_runtime ar ON ar.id = a.runtime_id
    WHERE ar.profile_id = $1 AND ar.workspace_id = $2 AND a.archived_at IS NULL
)
SELECT
    id,
    name,
    kind,
    system_key,
    runtime_id,
    runtime_name,
    runtime_custom_name,
    runtime_status,
    blocker_class,
    count(*) OVER () AS total_count,
    count(*) FILTER (WHERE blocker_class = 'user') OVER () AS user_count,
    count(*) FILTER (WHERE blocker_class = 'mika') OVER () AS mika_count,
    count(*) FILTER (WHERE blocker_class = 'agent_builder') OVER () AS agent_builder_count,
    count(*) FILTER (WHERE blocker_class = 'other_system') OVER () AS other_system_count
FROM blockers
ORDER BY runtime_name ASC, name ASC
LIMIT @max_rows::int;





-- name: ListAgentRuntimeIDsByProfile :many
SELECT id FROM agent_runtime
WHERE profile_id = $1 AND workspace_id = $2
ORDER BY id
FOR UPDATE;
