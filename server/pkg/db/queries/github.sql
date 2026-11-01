-- name: ListGitHubInstallationsByWorkspace :many
SELECT * FROM github_installation
WHERE workspace_id = $1
ORDER BY created_at ASC;





-- name: ListGitHubInstallationsByInstallationID :many
SELECT * FROM github_installation
WHERE installation_id = $1
ORDER BY created_at ASC, id ASC;





-- name: GetGitHubInstallationByID :one
SELECT * FROM github_installation
WHERE id = $1;





-- name: CreateGitHubInstallation :one
INSERT INTO github_installation (
    workspace_id, installation_id, account_login, account_type, account_avatar_url, connected_by_id
) VALUES (
    $1, $2, $3, $4, sqlc.narg('account_avatar_url'), sqlc.narg('connected_by_id')
)
ON CONFLICT (workspace_id, installation_id) DO UPDATE SET
    account_login = EXCLUDED.account_login,
    account_type = EXCLUDED.account_type,
    account_avatar_url = EXCLUDED.account_avatar_url,
    connected_by_id = EXCLUDED.connected_by_id,
    updated_at = now()
RETURNING *;





-- name: DeleteGitHubInstallation :exec
DELETE FROM github_installation WHERE id = $1 AND workspace_id = $2;





-- name: DeleteGitHubInstallationByInstallationID :many
DELETE FROM github_installation WHERE installation_id = $1
RETURNING id, workspace_id;





-- name: UpdateGitHubInstallationAccountByInstallationID :many
UPDATE github_installation
SET account_login = $2,
    account_type = $3,
    account_avatar_url = sqlc.narg('account_avatar_url'),
    updated_at = now()
WHERE installation_id = $1
RETURNING *;





-- name: UpsertPendingGitHubInstallation :one
INSERT INTO github_pending_installation (
    installation_id, account_login, account_type, account_avatar_url
) VALUES (
    $1, $2, $3, sqlc.narg('account_avatar_url')
)
ON CONFLICT (installation_id) DO UPDATE SET
    account_login = EXCLUDED.account_login,
    account_type = EXCLUDED.account_type,
    account_avatar_url = EXCLUDED.account_avatar_url,
    updated_at = now()
RETURNING *;





-- name: DeletePendingGitHubInstallation :exec
DELETE FROM github_pending_installation WHERE installation_id = $1;





-- name: GetPendingGitHubInstallation :one
SELECT * FROM github_pending_installation WHERE installation_id = $1
;



