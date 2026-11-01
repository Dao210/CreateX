-- name: LockPluginPackageKey :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));





-- name: CreatePluginPackage :one
INSERT INTO plugin_package (workspace_id, plugin_key, name, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;





-- name: UpdatePluginPackageName :one
UPDATE plugin_package
SET name = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: GetWorkspacePluginPackageByKey :one
SELECT * FROM plugin_package
WHERE workspace_id = $1 AND plugin_key = $2;





-- name: GetWorkspacePluginPackage :one
SELECT * FROM plugin_package
WHERE workspace_id = $1 AND id = $2;





-- name: ListWorkspacePluginPackages :many
SELECT * FROM plugin_package
WHERE workspace_id = $1
ORDER BY name ASC;





-- name: DeletePluginPackage :exec
DELETE FROM plugin_package WHERE id = $1;





-- name: CreatePluginPackageVersion :one
INSERT INTO plugin_package_version (
    package_id, workspace_id, version, manifest, digest, size_bytes, published_by
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;





-- name: ListPluginPackageVersions :many
SELECT * FROM plugin_package_version
WHERE package_id = $1
ORDER BY created_at DESC;





-- name: GetWorkspacePluginPackageVersion :one
SELECT * FROM plugin_package_version
WHERE workspace_id = $1 AND id = $2;





-- name: DeletePluginPackageVersionsByPackage :exec
DELETE FROM plugin_package_version WHERE package_id = $1;





-- name: CountInstallationsOfPackageVersions :one
SELECT count(*) FROM plugin_installation
WHERE package_version_id IN (
    SELECT id FROM plugin_package_version WHERE package_id = $1
);





-- name: CreatePluginPackageFile :exec
INSERT INTO plugin_package_file (version_id, path, content, size_bytes, sha256)
VALUES ($1, $2, $3, $4, $5);





-- name: GetPluginPackageFile :one
SELECT * FROM plugin_package_file
WHERE version_id = $1 AND path = $2;





-- name: ListPluginPackageFilePaths :many
SELECT path, size_bytes, sha256 FROM plugin_package_file
WHERE version_id = $1
ORDER BY path ASC;





-- name: DeletePluginPackageFilesByPackage :exec
DELETE FROM plugin_package_file
WHERE version_id IN (SELECT id FROM plugin_package_version WHERE package_id = $1);





-- name: CreatePluginInstallation :one
INSERT INTO plugin_installation (
    workspace_id, plugin_key, package_version_id, version, manifest, granted_scopes, installed_by
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;





-- name: UpdatePluginInstallationManifest :one
UPDATE plugin_installation
SET package_version_id = $2,
    version = $3,
    manifest = $4,
    granted_scopes = $5,
    config = $6,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: UpdatePluginInstallationConfig :one
UPDATE plugin_installation
SET config = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: SetPluginInstallationEnabled :one
UPDATE plugin_installation
SET enabled = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: GetPluginInstallation :one
SELECT * FROM plugin_installation WHERE id = $1;





-- name: GetWorkspacePluginInstallation :one
SELECT * FROM plugin_installation
WHERE workspace_id = $1 AND id = $2;





-- name: GetWorkspacePluginInstallationByKey :one
SELECT * FROM plugin_installation
WHERE workspace_id = $1 AND plugin_key = $2;





-- name: ListWorkspacePluginInstallations :many
SELECT * FROM plugin_installation
WHERE workspace_id = $1
ORDER BY created_at ASC;





-- name: DeletePluginInstallation :exec
DELETE FROM plugin_installation WHERE id = $1;





-- name: CreatePluginHookSchedule :one
INSERT INTO plugin_hook_schedule (
    installation_id, workspace_id, hook_key, cron_expression, timezone,
    next_run_at, enabled
) VALUES ($1, $2, $3, $4, $5, sqlc.narg(next_run_at), $6)
RETURNING *;





-- name: GetPluginHookSchedule :one
SELECT * FROM plugin_hook_schedule WHERE id = $1;





-- name: ListPluginHookSchedulesByInstallation :many
SELECT * FROM plugin_hook_schedule
WHERE installation_id = $1
ORDER BY hook_key ASC;





-- name: ListEnabledPluginHookSchedules :many
SELECT * FROM plugin_hook_schedule
WHERE enabled
ORDER BY id ASC;





-- name: UpdatePluginHookScheduleDefinition :one
UPDATE plugin_hook_schedule
SET cron_expression = $2,
    timezone = $3,
    generation = gen_random_uuid(),
    activated_at = now(),
    next_run_at = sqlc.narg(next_run_at),
    enabled = $4,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: DisablePluginHookSchedules :exec
UPDATE plugin_hook_schedule
SET enabled = FALSE, next_run_at = NULL, updated_at = now()
WHERE installation_id = $1;





-- name: ReactivatePluginHookSchedule :one
UPDATE plugin_hook_schedule
SET enabled = TRUE,
    generation = gen_random_uuid(),
    activated_at = now(),
    next_run_at = sqlc.narg(next_run_at),
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: UpdatePluginHookScheduleNextRun :execrows
UPDATE plugin_hook_schedule
SET next_run_at = sqlc.narg(next_run_at), updated_at = now()
WHERE id = $1 AND generation = $2 AND enabled;





-- name: DeletePluginHookSchedule :exec
DELETE FROM plugin_hook_schedule WHERE id = $1;





-- name: DeletePluginHookSchedulesByInstallation :exec
DELETE FROM plugin_hook_schedule WHERE installation_id = $1;





-- name: UpsertPluginStorageValue :one
INSERT INTO plugin_storage (installation_id, scope_type, scope_id, key, value)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (installation_id, scope_type, scope_id, key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now()
RETURNING *;





-- name: GetPluginStorageValue :one
SELECT * FROM plugin_storage
WHERE installation_id = $1 AND scope_type = $2 AND scope_id = $3 AND key = $4;





-- name: ListPluginStorageKeys :many
SELECT key, octet_length(value)::bigint AS size_bytes, updated_at
FROM plugin_storage
WHERE installation_id = $1 AND scope_type = $2 AND scope_id = $3
ORDER BY key ASC;





-- name: DeletePluginStorageValue :execrows
DELETE FROM plugin_storage
WHERE installation_id = $1 AND scope_type = $2 AND scope_id = $3 AND key = $4;





-- name: GetPluginStorageUsage :one
SELECT COUNT(*)::bigint AS key_count,
       COALESCE(SUM(octet_length(value)), 0)::bigint AS total_bytes
FROM plugin_storage
WHERE installation_id = $1 AND scope_type = $2 AND scope_id = $3 AND key <> $4;





-- name: DeletePluginStorageByInstallation :exec
DELETE FROM plugin_storage WHERE installation_id = $1;





-- name: UpsertPluginSecret :exec
INSERT INTO plugin_secret (installation_id, key, ciphertext)
VALUES ($1, $2, $3)
ON CONFLICT (installation_id, key)
DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now();





-- name: ListPluginSecretKeys :many
SELECT key, updated_at FROM plugin_secret
WHERE installation_id = $1
ORDER BY key ASC;





-- name: GetPluginSecret :one
SELECT * FROM plugin_secret
WHERE installation_id = $1 AND key = $2;





-- name: DeletePluginSecret :execrows
DELETE FROM plugin_secret WHERE installation_id = $1 AND key = $2;





-- name: DeletePluginSecretsByInstallation :exec
DELETE FROM plugin_secret WHERE installation_id = $1;





-- name: SetPluginInstallationToken :exec
UPDATE plugin_installation
SET token_hash = $2, token_rotated_at = now(), updated_at = now()
WHERE id = $1;





-- name: GetPluginInstallationByTokenHash :one
SELECT * FROM plugin_installation WHERE token_hash = $1;





-- name: CreatePluginInvocation :one
INSERT INTO plugin_invocation (
    id, installation_id, workspace_id, hook_key, trigger, status, event_type,
    delivery_id, planned_at, attempt, latency_ms, error
) VALUES (
    COALESCE(sqlc.narg('id')::uuid, gen_random_uuid()),
    $1, $2, $3, $4, $5, sqlc.narg(event_type), sqlc.narg(delivery_id),
    sqlc.narg(planned_at), $6, $7, sqlc.narg(error)
)
RETURNING *;





-- name: ListPluginInvocations :many
SELECT * FROM plugin_invocation
WHERE installation_id = $1
ORDER BY created_at DESC
LIMIT $2;





-- name: CountRecentPluginInvocations :one
SELECT count(*) FROM plugin_invocation
WHERE installation_id = $1 AND hook_key = $2 AND created_at > $3;





-- name: CountRecentPluginFailures :one
SELECT count(*) FROM plugin_invocation
WHERE installation_id = $1 AND hook_key = $2 AND created_at > $3 AND status <> 'ok';





-- name: DeletePluginInvocationsByInstallation :exec
DELETE FROM plugin_invocation WHERE installation_id = $1;





-- name: DeleteExpiredPluginInvocations :execrows
DELETE FROM plugin_invocation WHERE created_at < $1;





-- name: UpsertPluginSkill :one
INSERT INTO skill (workspace_id, name, description, content, config, created_by, plugin_installation_id)
VALUES ($1, $2, $3, $4, '{}'::jsonb, sqlc.narg(created_by), $5)
ON CONFLICT (workspace_id, name) DO UPDATE SET
    description = EXCLUDED.description,
    content = EXCLUDED.content,
    updated_at = now()
WHERE skill.plugin_installation_id = EXCLUDED.plugin_installation_id
RETURNING *;





-- name: ListPluginSkills :many
SELECT * FROM skill WHERE plugin_installation_id = $1 ORDER BY name ASC;





-- name: DeletePluginSkillsByInstallation :exec
DELETE FROM skill WHERE plugin_installation_id = $1;





-- name: DeletePluginSkillsNotIn :exec
DELETE FROM skill
WHERE plugin_installation_id = $1 AND name <> ALL(@keep_names::text[]);





-- name: SetPluginMCPApprovals :one
UPDATE plugin_installation
SET mcp_approvals = $2, updated_at = now()
WHERE id = $1
RETURNING *;
