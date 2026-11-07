-- name: GetGamePolicy :one
SELECT * FROM game_policy WHERE game_id = $1;





-- name: PutGamePolicy :one
INSERT INTO game_policy (game_id, scope, default_visible, revision, updated_by)
SELECT @game_id, @scope, @default_visible, 1, @updated_by::uuid
WHERE @expected_revision::integer = 0 OR EXISTS (
    SELECT 1 FROM game_policy WHERE game_id = @game_id AND revision = @expected_revision
)
ON CONFLICT (game_id) DO UPDATE
SET scope = EXCLUDED.scope, default_visible = EXCLUDED.default_visible,
    revision = game_policy.revision + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
WHERE game_policy.revision = @expected_revision::integer
RETURNING *;





-- name: ListGameWorldOverrides :many
SELECT o.*, w.name AS workspace_name, w.slug AS workspace_slug
FROM game_world_override o JOIN workspace w ON w.id = o.workspace_id
WHERE o.game_id = $1 ORDER BY o.workspace_id;





-- name: DeleteGameWorldOverrides :exec
DELETE FROM game_world_override WHERE game_id = $1;





-- name: InsertGameWorldOverride :exec
INSERT INTO game_world_override (game_id, workspace_id, access, visibility)
VALUES ($1, $2, $3, $4);





-- name: GetLifeGameBinding :one
SELECT COALESCE(w.id,l.id)::uuid AS id, COALESCE(w.name,'')::text AS name, COALESCE(w.slug,'')::text AS slug, l.updated_at
FROM life_world l LEFT JOIN workspace w ON w.id = l.workspace_id LIMIT 1;





-- name: SearchGameAdminWorlds :many
SELECT id, name, slug FROM workspace
WHERE (name ILIKE '%' || @search::text || '%' OR slug ILIKE '%' || @search::text || '%')
  AND (sqlc.narg('after_id')::uuid IS NULL OR id > sqlc.narg('after_id'))
ORDER BY id LIMIT 26;





-- name: CountGamePolicyImpact :one
WITH proposed AS (
    SELECT unnest(@override_ids::uuid[]) AS workspace_id,
           unnest(@override_access::text[]) AS access,
           unnest(@override_visibility::text[]) AS visibility
), resolved AS (
    SELECT
      @scope::text <> 'disabled'
      AND COALESCE(o.access, 'inherit') <> 'deny'
      AND (@scope::text = 'all' OR o.access = 'allow') AS available,
      CASE COALESCE(o.visibility, 'inherit') WHEN 'show' THEN true WHEN 'hide' THEN false ELSE @default_visible::boolean END AS visible
    FROM workspace w LEFT JOIN proposed o ON o.workspace_id = w.id
)
SELECT count(*)::bigint AS total,
       count(*) FILTER (WHERE available)::bigint AS available,
       count(*) FILTER (WHERE available AND visible)::bigint AS visible
FROM resolved;





-- name: InsertGamePolicyAudit :exec
INSERT INTO game_policy_audit (game_id, revision, actor_id, previous, current)
VALUES ($1, $2, $3, $4, $5);





-- name: ListGamePolicyAudit :many
SELECT a.*, COALESCE(u.name, '')::text AS actor_name, COALESCE(u.email, '')::text AS actor_email
FROM game_policy_audit a LEFT JOIN "user" u ON u.id = a.actor_id
WHERE a.game_id = @game_id AND (@before_revision::integer = 0 OR a.revision < @before_revision)
ORDER BY a.revision DESC LIMIT 26;





-- name: GetEffectiveGamePolicy :one
SELECT
    COALESCE(p.scope, 'all')::text AS scope,
    COALESCE(p.default_visible, true)::boolean AS default_visible,
    COALESCE(o.access, 'inherit')::text AS access,
    COALESCE(o.visibility, 'inherit')::text AS visibility
FROM (SELECT 1) seed
LEFT JOIN game_policy p ON p.game_id = @game_id
LEFT JOIN game_world_override o ON o.game_id = @game_id AND o.workspace_id = @workspace_id;
