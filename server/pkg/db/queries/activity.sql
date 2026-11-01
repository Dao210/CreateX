-- name: GetActivity :one
SELECT * FROM activity_log
WHERE id = $1;





-- name: CreateActivity :one
INSERT INTO activity_log (workspace_id,actor_type,actor_id,action,details,id)
VALUES($1,$2,$3,$4,$5,COALESCE(sqlc.narg('id')::uuid,gen_random_uuid())) RETURNING *;



-- name: CountAssigneeChangesByActor :many
SELECT
  details->>'to_type' as assignee_type,
  details->>'to_id' as assignee_id,
  COUNT(*)::bigint as frequency
FROM activity_log
WHERE workspace_id = $1
  AND actor_id = $2
  AND actor_type = 'member'
  AND action = 'assignee_changed'
  AND details->>'to_type' IS NOT NULL
  AND details->>'to_id' IS NOT NULL
GROUP BY details->>'to_type', details->>'to_id';
