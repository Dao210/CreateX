-- name: CreateTaskMessage :one
INSERT INTO task_message (id, task_id, seq, type, tool, content, input, output, output_truncated, call_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;





-- name: CreateTaskMessages :many
WITH incoming AS (
    SELECT
        unnest(sqlc.arg('ids')::uuid[]) AS id,
        unnest(sqlc.arg('seqs')::int4[]) AS seq,
        unnest(sqlc.arg('types')::text[]) AS type,
        unnest(sqlc.arg('tools')::text[]) AS tool,
        unnest(sqlc.arg('call_ids')::text[]) AS call_id,
        unnest(sqlc.arg('contents')::text[]) AS content,
        unnest(sqlc.arg('inputs')::text[]) AS input,
        unnest(sqlc.arg('outputs')::text[]) AS output,
        unnest(sqlc.arg('created_ats')::text[]) AS created_at,
        unnest(sqlc.arg('output_truncations')::text[]) AS output_truncated
), inserted AS (
    INSERT INTO task_message (id, task_id, seq, type, tool, content, input, output, created_at, output_truncated, call_id)
    SELECT
        m.id,
        sqlc.arg('task_id')::uuid,
        m.seq,
        m.type,
        NULLIF(m.tool, ''),
        NULLIF(m.content, ''),
        NULLIF(m.input, '')::jsonb,
        NULLIF(m.output, ''),
        COALESCE(NULLIF(m.created_at, '')::timestamptz, now()),
        NULLIF(m.output_truncated, '')::bool,
        NULLIF(m.call_id, '')
    FROM incoming AS m
    RETURNING *
)
SELECT * FROM inserted ORDER BY seq ASC;





-- name: ListTaskMessages :many
SELECT * FROM task_message
WHERE task_id = $1
ORDER BY seq ASC;





-- name: ListTaskMessagesSince :many
SELECT * FROM task_message
WHERE task_id = $1 AND seq > $2
ORDER BY seq ASC;





-- name: DeleteTaskMessages :exec
DELETE FROM task_message
WHERE task_id = $1;
