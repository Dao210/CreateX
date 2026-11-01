-- name: CreateAttachment :one
INSERT INTO attachment(id,workspace_id,chat_session_id,task_id,uploader_type,uploader_id,filename,url,content_type,size_bytes)
VALUES($1,$2,sqlc.narg(chat_session_id),sqlc.narg(task_id),$3,$4,$5,$6,$7,$8) RETURNING *;



-- name: GetAttachment :one
SELECT * FROM attachment
WHERE id = $1 AND workspace_id = $2;





-- name: GetAttachmentByIDOnly :one
SELECT * FROM attachment
WHERE id = $1;





-- name: LinkAttachmentsToChatMessage :many
UPDATE attachment
SET chat_message_id = sqlc.arg(chat_message_id),
    chat_session_id = sqlc.arg(chat_session_id)
WHERE workspace_id = sqlc.arg(workspace_id)


  AND chat_message_id IS NULL

  AND (
    chat_session_id IS NULL
    OR chat_session_id = sqlc.arg(chat_session_id)
  )
  AND uploader_type = sqlc.arg(uploader_type)
  AND uploader_id = sqlc.arg(uploader_id)
  AND id = ANY(sqlc.arg(attachment_ids)::uuid[])
RETURNING id;





-- name: DetachAttachmentsFromUserChatMessageByTask :many
UPDATE attachment
SET chat_message_id = NULL
WHERE chat_message_id IN (
  SELECT id FROM chat_message WHERE chat_message.task_id = $1 AND role = 'user'
)
RETURNING *;





-- name: CountUnboundChatAttachmentsForTask :one
SELECT COUNT(*) FROM attachment
WHERE workspace_id = sqlc.arg(workspace_id)
  AND task_id = sqlc.arg(task_id)


  AND chat_message_id IS NULL;





-- name: BindChatAttachmentsToMessage :many
UPDATE attachment
SET chat_message_id = sqlc.arg(chat_message_id)
WHERE workspace_id = sqlc.arg(workspace_id)
  AND task_id = sqlc.arg(task_id)


  AND chat_message_id IS NULL

RETURNING id;





-- name: ListAttachmentsByChatMessage :many
SELECT * FROM attachment
WHERE chat_message_id = $1 AND workspace_id = $2
ORDER BY created_at ASC;





-- name: ListAttachmentsByChatMessageIDs :many
SELECT * FROM attachment
WHERE chat_message_id = ANY($1::uuid[]) AND workspace_id = $2
ORDER BY created_at ASC;





-- name: LockAttachmentRow :one
SELECT * FROM attachment
WHERE id = $1 AND workspace_id = $2
FOR UPDATE;





-- name: DeleteAttachment :one
DELETE FROM attachment WHERE id=$1 AND workspace_id=$2 RETURNING id;



-- name: ListAttachmentsByIDs :many
SELECT * FROM attachment
WHERE id = ANY(sqlc.arg(attachment_ids)::uuid[]) AND workspace_id = sqlc.arg(workspace_id)
ORDER BY created_at ASC;



