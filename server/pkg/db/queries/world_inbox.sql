-- name: RecordWorldInboxEvent :exec
INSERT INTO world_inbox_event (id, workspace_id, actor_id, subject_id, kind, content)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO NOTHING;





-- name: LockWorldInboxWrites :exec
SELECT pg_advisory_xact_lock_shared(19647, hashtext(sqlc.arg(workspace_id)::text));
