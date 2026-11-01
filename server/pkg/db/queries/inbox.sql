-- name: ListInboxItems :many
SELECT id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content FROM inbox_item WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND workspace_id=$1 AND recipient_type=$2 AND recipient_id=$3 AND NOT archived ORDER BY created_at DESC,id DESC;

-- name: ListArchivedInboxItems :many
SELECT id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content FROM inbox_item WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND workspace_id=$1 AND recipient_type=$2 AND recipient_id=$3 AND archived ORDER BY created_at DESC,id DESC LIMIT 200;

-- name: GetInboxItemInWorkspace :one
SELECT id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content FROM inbox_item
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND id = $1 AND workspace_id = $2;

-- name: CreateInboxItem :one
INSERT INTO inbox_item(workspace_id,recipient_type,recipient_id,type,severity,title,body,actor_type,actor_id,details,id)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE(sqlc.narg('id')::uuid,gen_random_uuid())) RETURNING id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content;

-- name: MarkInboxRead :one
UPDATE inbox_item SET read = true
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND id = $1
RETURNING id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content;

-- name: MarkInboxUnread :one
UPDATE inbox_item SET read = false
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND id = $1
RETURNING id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content;

-- name: ArchiveInboxItem :one
UPDATE inbox_item SET archived = true
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND id = $1
RETURNING id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content;

-- name: UnarchiveInboxItem :one
UPDATE inbox_item SET archived = false
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND id = $1
RETURNING id, workspace_id, recipient_type, recipient_id, type, severity, title, body, read, archived, created_at, actor_type, actor_id, details, content;

-- name: CountUnreadInbox :one
SELECT count(*) FROM inbox_item
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND workspace_id = $1 AND recipient_type = $2 AND recipient_id = $3 AND read = false AND archived = false;

-- name: CountUnreadInboxByWorkspace :many
SELECT i.workspace_id,count(*) AS count FROM inbox_item i JOIN member m ON m.workspace_id=i.workspace_id AND m.user_id=i.recipient_id WHERE i.type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND i.recipient_type='member' AND i.recipient_id=$1 AND NOT i.archived AND NOT i.read GROUP BY i.workspace_id;

-- name: MarkAllInboxRead :execrows
UPDATE inbox_item SET read = true
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND workspace_id = $1 AND recipient_type = 'member' AND recipient_id = $2 AND archived = false AND read = false;

-- name: ArchiveAllInbox :execrows
UPDATE inbox_item SET archived = true
WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND workspace_id = $1 AND recipient_type = 'member' AND recipient_id = $2 AND archived = false;

-- name: ArchiveAllReadInbox :execrows
UPDATE inbox_item SET archived=true WHERE type IN ('autopilot_paused', 'autopilot_quota_exceeded', 'creation_ready', 'character_milestone', 'world_digest') AND workspace_id=$1 AND recipient_type='member' AND recipient_id=$2 AND NOT archived AND read;
