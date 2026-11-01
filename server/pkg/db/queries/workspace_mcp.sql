-- name: ListWorkspaceMcpServers :many
SELECT * FROM workspace_mcp_server
WHERE workspace_id = $1
ORDER BY name ASC;





-- name: CountWorkspaceMcpServerAgents :many
SELECT ams.server_id, COUNT(*)::bigint AS agent_count
FROM agent_mcp_server ams
JOIN workspace_mcp_server s ON s.id = ams.server_id
JOIN agent a ON a.id = ams.agent_id
WHERE s.workspace_id = $1 AND a.archived_at IS NULL
GROUP BY ams.server_id;





-- name: LockWorkspaceMcpServerForShare :one
SELECT id FROM workspace_mcp_server
WHERE id = $1 AND workspace_id = $2
FOR SHARE;





-- name: LockWorkspaceMcpServerForUpdate :one
SELECT id FROM workspace_mcp_server
WHERE id = $1 AND workspace_id = $2
FOR UPDATE;





-- name: GetWorkspaceMcpServer :one
SELECT * FROM workspace_mcp_server
WHERE id = $1 AND workspace_id = $2;





-- name: CreateWorkspaceMcpServer :one
INSERT INTO workspace_mcp_server (workspace_id, name, config, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;





-- name: UpdateWorkspaceMcpServer :one
UPDATE workspace_mcp_server SET
    name = COALESCE(sqlc.narg('name'), name),
    config = COALESCE(sqlc.narg('config'), config),
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;





-- name: DeleteWorkspaceMcpServer :execrows
DELETE FROM workspace_mcp_server
WHERE id = $1 AND workspace_id = $2;





-- name: DeleteAgentMcpServersByServer :exec
DELETE FROM agent_mcp_server WHERE server_id = $1;





-- name: ListAgentMcpServers :many
SELECT s.id, s.workspace_id, s.name, s.config, s.created_at, s.updated_at, ams.enabled
FROM workspace_mcp_server s
JOIN agent_mcp_server ams ON ams.server_id = s.id
WHERE ams.agent_id = $1
ORDER BY s.name ASC;





-- name: ListEnabledAgentMcpServers :many
SELECT s.name, s.config
FROM workspace_mcp_server s
JOIN agent_mcp_server ams ON ams.server_id = s.id
WHERE ams.agent_id = $1 AND ams.enabled = TRUE
ORDER BY s.name ASC;





-- name: AddAgentMcpServer :exec
INSERT INTO agent_mcp_server (agent_id, server_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;





-- name: SetAgentMcpServerEnabled :execrows
UPDATE agent_mcp_server
SET enabled = $3
WHERE agent_id = $1 AND server_id = $2;





-- name: RemoveAgentMcpServer :execrows
DELETE FROM agent_mcp_server
WHERE agent_id = $1 AND server_id = $2;
