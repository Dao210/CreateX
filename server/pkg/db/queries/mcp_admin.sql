-- name: GetMCPServicePolicy :one
SELECT * FROM mcp_service_policy WHERE service_id = $1;

-- name: PutMCPServicePolicy :one
INSERT INTO mcp_service_policy (service_id, enabled, disabled_tools, revision, updated_by)
SELECT @service_id, @enabled, @disabled_tools::text[], 1, @updated_by::uuid
WHERE @expected_revision::integer = 0 OR EXISTS (
    SELECT 1 FROM mcp_service_policy WHERE service_id = @service_id AND revision = @expected_revision
)
ON CONFLICT (service_id) DO UPDATE
SET enabled = EXCLUDED.enabled, disabled_tools = EXCLUDED.disabled_tools,
    revision = mcp_service_policy.revision + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
WHERE mcp_service_policy.revision = @expected_revision::integer
RETURNING *;

-- name: LockMCPAdminUser :one
SELECT email FROM "user" WHERE id = $1 FOR SHARE;

-- name: InsertMCPActivity :exec
INSERT INTO mcp_activity (id, service_id, workspace_id, actor_id, kind, tool_name, outcome, error_code, duration_ms, details)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- name: MCPToolStats :many
SELECT tool_name, count(*)::bigint AS calls,
       count(*) FILTER (WHERE outcome = 'error')::bigint AS errors,
       count(*) FILTER (WHERE outcome = 'blocked')::bigint AS blocked,
       COALESCE(avg(duration_ms), 0)::float8 AS average_ms,
       max(occurred_at)::timestamptz AS last_called_at
FROM mcp_activity
WHERE service_id = $1 AND kind = 'call' AND occurred_at >= now() - interval '24 hours'
GROUP BY tool_name;

-- name: ListMCPActivity :many
SELECT a.*, COALESCE(u.name, '')::text AS actor_name,
       COALESCE(u.email, '')::text AS actor_email,
       COALESCE(w.name, '')::text AS workspace_name, COALESCE(w.slug, '')::text AS workspace_slug
FROM mcp_activity a
LEFT JOIN "user" u ON u.id = a.actor_id
LEFT JOIN workspace w ON w.id = a.workspace_id
WHERE a.service_id = @service_id
  AND (@tool_name::text = '' OR a.tool_name = @tool_name)
  AND (@outcome::text = '' OR a.outcome = @outcome)
  AND (sqlc.narg('workspace_id')::uuid IS NULL OR a.workspace_id = sqlc.narg('workspace_id'))
  AND (sqlc.narg('before_time')::timestamptz IS NULL OR (a.occurred_at, a.id) < (sqlc.narg('before_time'), sqlc.narg('before_id')::uuid))
ORDER BY a.occurred_at DESC, a.id DESC
LIMIT 51;

-- name: PruneMCPActivity :exec
DELETE FROM mcp_activity WHERE id IN (
    SELECT old.id FROM mcp_activity old WHERE old.service_id = $1 AND old.occurred_at < now() - interval '30 days'
    ORDER BY old.occurred_at LIMIT 500
);
