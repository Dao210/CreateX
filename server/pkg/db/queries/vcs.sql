-- name: ListVCSConnectionsByWorkspace :many
SELECT * FROM vcs_connection
WHERE workspace_id = $1
ORDER BY created_at ASC;





-- name: GetVCSConnectionByID :one
SELECT * FROM vcs_connection
WHERE id = $1;





-- name: UpsertVCSConnection :one
INSERT INTO vcs_connection (
    workspace_id, provider, instance_url, account_login,
    access_token_encrypted, webhook_secret_encrypted, connected_by_id
) VALUES (
    $1, $2, $3, $4, $5, $6, sqlc.narg('connected_by_id')
)
ON CONFLICT (workspace_id, instance_url) DO UPDATE SET
    provider                 = EXCLUDED.provider,
    account_login            = EXCLUDED.account_login,
    access_token_encrypted   = EXCLUDED.access_token_encrypted,
    webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
    connected_by_id          = EXCLUDED.connected_by_id,
    updated_at               = now()
RETURNING *;





-- name: DeleteVCSConnection :exec
DELETE FROM vcs_connection WHERE id=$1;



-- name: RotateVCSConnectionWebhookSecret :one
UPDATE vcs_connection
SET webhook_secret_encrypted = $3,
    updated_at = now()
WHERE id = $1 AND workspace_id = $2
RETURNING *;



