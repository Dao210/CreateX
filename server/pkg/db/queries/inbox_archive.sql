-- name: ListArchivedInboxPage :many
SELECT i.* FROM inbox_item i WHERE i.workspace_id=sqlc.arg(workspace_id)::uuid AND i.recipient_type='member' AND i.recipient_id=sqlc.arg(recipient_id)::uuid AND i.archived
AND (sqlc.narg(group_id)::uuid IS NULL OR i.id=sqlc.narg(group_id)::uuid)
AND (cardinality(sqlc.arg(actors)::text[])=0 OR CASE WHEN i.actor_type='system' THEN 'system' ELSE i.actor_type||':'||i.actor_id::text END=ANY(sqlc.arg(actors)::text[]))
AND (NOT sqlc.arg(unread_only)::boolean OR NOT i.read)
AND (sqlc.narg(before_time)::timestamptz IS NULL OR (i.created_at,i.id)<(sqlc.narg(before_time)::timestamptz,sqlc.narg(before_id)::uuid))
ORDER BY i.created_at DESC,i.id DESC LIMIT sqlc.arg(page_limit)::int;


-- name: ArchivedInboxFacets :many
WITH matched AS(SELECT i.*,
CASE WHEN i.actor_type='system' THEN 'system' ELSE i.actor_type||':'||i.actor_id::text END AS actor,
(cardinality(sqlc.arg(actors)::text[])=0 OR CASE WHEN i.actor_type='system' THEN 'system' ELSE i.actor_type||':'||i.actor_id::text END=ANY(sqlc.arg(actors)::text[])) AS actor_match,
(NOT sqlc.arg(unread_only)::boolean OR NOT i.read) AS read_match
FROM inbox_item i WHERE i.workspace_id=sqlc.arg(workspace_id)::uuid AND i.recipient_type='member' AND i.recipient_id=sqlc.arg(recipient_id)::uuid AND i.archived)
SELECT 'actors'::text AS dimension,actor::text AS key,count(*) FILTER(WHERE read_match)::bigint AS count FROM matched WHERE actor IS NOT NULL GROUP BY actor
UNION ALL SELECT 'unread'::text,'unread'::text,count(*) FILTER(WHERE actor_match AND NOT read)::bigint FROM matched;
