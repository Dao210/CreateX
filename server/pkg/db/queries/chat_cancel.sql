-- name: HasTaskMessages :one
SELECT EXISTS (SELECT 1 FROM task_message WHERE task_id = $1);
