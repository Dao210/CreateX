-- name: ListWorkspaces :many
SELECT w.id, w.name, w.slug, w.description, w.settings,
       w.created_at, w.updated_at, w.context, w.repos,
       w.avatar_url, w.attribution_fail_closed
FROM member m
JOIN workspace w ON w.id = m.workspace_id
WHERE m.user_id = $1
ORDER BY w.created_at ASC;





-- name: ListDaemonWorkspaces :many
SELECT w.id, w.name
FROM member m
JOIN workspace w ON w.id = m.workspace_id
WHERE m.user_id = $1
ORDER BY w.id ASC;





-- name: GetDaemonWorkspace :one
SELECT id, name
FROM workspace
WHERE id = $1;





-- name: GetWorkspace :one
SELECT * FROM workspace
WHERE id = $1;





-- name: GetWorkspaceBySlug :one
SELECT * FROM workspace
WHERE slug = $1;





-- name: GetWorkspaceAttributionFailClosed :one
SELECT attribution_fail_closed FROM workspace
WHERE id = $1;





-- name: CreateWorkspace :one
INSERT INTO workspace(name,slug,description,context) VALUES($1,$2,$3,$4) RETURNING *;



-- name: UpdateWorkspace :one
UPDATE workspace SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    context = COALESCE(sqlc.narg('context'), context),
    settings = COALESCE(sqlc.narg('settings'), settings),
    repos = COALESCE(sqlc.narg('repos'), repos),
    avatar_url = COALESCE(sqlc.narg('avatar_url'), avatar_url),
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: LockWorkspaceForDelete :one
SELECT id FROM workspace WHERE id = $1 FOR UPDATE;





-- name: LockWorkspaceForChatSessionCreate :one
SELECT id FROM workspace WHERE id = $1 FOR KEY SHARE;





-- name: DeleteWorkspace :exec
DELETE FROM workspace WHERE id=$1;
