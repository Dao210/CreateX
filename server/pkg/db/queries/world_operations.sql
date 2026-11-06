-- name: RecordWorldOpsVisit :execrows
WITH actor AS (
    SELECT w.id AS workspace_id, m.user_id
    FROM workspace w JOIN member m ON m.workspace_id = w.id
    WHERE w.id = $1 AND m.user_id = $2
    FOR KEY SHARE OF w, m
), observed AS (
    SELECT statement_timestamp() AS seen_at
)
INSERT INTO world_ops_visit (workspace_id, user_id, visit_day, first_seen_at)
SELECT actor.workspace_id, actor.user_id, (seen_at AT TIME ZONE 'Asia/Shanghai')::date, seen_at
FROM actor CROSS JOIN observed
ON CONFLICT (workspace_id, visit_day, user_id) DO UPDATE
SET first_seen_at = LEAST(world_ops_visit.first_seen_at, EXCLUDED.first_seen_at);

-- name: WorldOpsCoverage :one
SELECT started_at FROM world_ops_coverage LIMIT 1;

-- name: WorldOpsRead :one
WITH bounds AS (
    SELECT sqlc.arg(from_at)::timestamptz AS from_at,
           sqlc.arg(to_at)::timestamptz AS to_at,
           sqlc.arg(snapshot_at)::timestamptz AS snapshot_at,
           sqlc.arg(previous_at)::timestamptz AS previous_at,
           sqlc.arg(from_day)::date AS from_day,
           sqlc.arg(to_day)::date AS to_day,
           sqlc.arg(coverage_at)::timestamptz AS coverage_at,
           sqlc.arg(actor_id)::uuid AS actor_id,
           sqlc.arg(game)::text AS game,
           sqlc.arg(search)::text AS search,
           sqlc.arg(segment)::text AS segment
), worlds AS MATERIALIZED (
    SELECT w.id, w.name, w.slug, w.created_at
    FROM workspace w CROSS JOIN bounds p
    WHERE w.created_at < p.snapshot_at
      AND (sqlc.narg(world_id)::uuid IS NULL OR w.id = sqlc.narg(world_id))
), member_counts AS (
    SELECT m.workspace_id, count(*) AS members
    FROM member m JOIN worlds w ON w.id = m.workspace_id GROUP BY m.workspace_id
), visit_days AS MATERIALIZED (
    SELECT v.workspace_id, v.user_id, v.visit_day,
           row_number() OVER (PARTITION BY v.workspace_id, v.user_id ORDER BY v.visit_day) > 1 AS is_return
    FROM world_ops_visit v JOIN worlds w ON w.id = v.workspace_id CROSS JOIN bounds p
    WHERE v.visit_day BETWEEN p.from_day AND p.to_day AND v.first_seen_at < p.to_at
), visitor_counts AS (
    SELECT workspace_id, count(*) AS visitors, count(*) FILTER (WHERE days >= 2) AS returning_count
    FROM (
        SELECT workspace_id, user_id, count(*) AS days FROM visit_days GROUP BY workspace_id, user_id
    ) v GROUP BY workspace_id
), creations AS MATERIALIZED (
    SELECT c.* FROM world_ops_creation c JOIN worlds w ON w.id = c.workspace_id CROSS JOIN bounds p
    WHERE c.occurred_at < p.to_at AND (p.game = '' OR c.game = p.game)
), events AS MATERIALIZED (
    SELECT workspace_id, user_id, game, origin, occurred_at,
           CASE WHEN revision = 1 THEN 'creation' ELSE 'revision' END AS kind
    FROM creations
    UNION ALL
    SELECT a.workspace_id, a.user_id, a.game, a.origin, a.occurred_at, a.kind
    FROM world_ops_action a JOIN worlds w ON w.id = a.workspace_id CROSS JOIN bounds p
    WHERE a.occurred_at < p.to_at AND (p.game = '' OR a.game = p.game)
), event_counts AS (
    SELECT e.workspace_id,
           count(*) FILTER (WHERE e.occurred_at >= p.from_at) AS actions,
           count(DISTINCT e.user_id) FILTER (WHERE e.occurred_at >= p.from_at AND e.origin = 'manual') AS active_members,
           count(DISTINCT e.user_id) FILTER (WHERE e.occurred_at >= p.previous_at AND e.occurred_at < p.from_at AND e.origin = 'manual') AS prior_members,
           count(*) FILTER (WHERE e.occurred_at >= p.from_at AND e.kind = 'creation') AS creations,
           count(*) FILTER (WHERE e.occurred_at >= p.previous_at AND e.occurred_at < p.from_at AND e.kind = 'creation') AS prior_creations,
           min(e.occurred_at) FILTER (WHERE e.kind = 'creation') AS first_creation,
           max(e.occurred_at) AS last_action
    FROM events e CROSS JOIN bounds p GROUP BY e.workspace_id
), rows AS MATERIALIZED (
    SELECT w.id, w.name, w.slug, w.created_at AS "createdAt",
           coalesce(m.members, 0) AS members, coalesce(v.visitors, 0) AS visitors,
           coalesce(v.returning_count, 0) AS "returning", coalesce(e.actions, 0) AS actions,
           coalesce(e.active_members, 0) AS "activeMembers", coalesce(e.prior_members, 0) AS "priorMembers",
           coalesce(e.creations, 0) AS creations, coalesce(e.prior_creations, 0) AS "priorCreations",
           e.first_creation AS "firstCreation", e.last_action AS "lastAction",
           (w.created_at < p.to_at AND greatest(w.created_at, p.from_at) >= p.coverage_at) AS covered,
           greatest(w.created_at, p.previous_at) >= p.coverage_at AS "previousCovered",
           (w.created_at >= p.from_at AND w.created_at >= p.coverage_at AND w.created_at + interval '168 hours' <= p.to_at) AS "cohortEligible",
           f.id IS NOT NULL AS "following", coalesce(f.assignee_id = p.actor_id, false) AS mine, f.due_on AS "dueOn", f.created_at AS "followupCreatedAt",
           (w.created_at >= p.from_at AND w.created_at < p.to_at) AS "newWorld"
    FROM worlds w CROSS JOIN bounds p
    LEFT JOIN member_counts m ON m.workspace_id = w.id
    LEFT JOIN visitor_counts v ON v.workspace_id = w.id
    LEFT JOIN event_counts e ON e.workspace_id = w.id
    LEFT JOIN world_ops_followup f ON f.workspace_id = w.id AND f.closed_at IS NULL
), filtered AS MATERIALIZED (
    SELECT r.* FROM rows r CROSS JOIN bounds p
    WHERE (p.search = '' OR strpos(lower(r.name), lower(p.search)) > 0 OR strpos(lower(r.slug), lower(p.search)) > 0)
      AND CASE p.segment
          WHEN 'new' THEN r."newWorld"
          WHEN 'visited' THEN r.visitors > 0
          WHEN 'browsing' THEN r.covered AND p.game = '' AND r.visitors > 0 AND r.actions = 0
          WHEN 'returning' THEN r."returning" > 0
          WHEN 'active' THEN r.actions > 0
          WHEN 'creative' THEN r.creations > 0
          WHEN 'first' THEN r."cohortEligible" AND r."firstCreation" < r."createdAt" + interval '168 hours'
          WHEN 'cohort' THEN r."cohortEligible"
          WHEN 'no-visit' THEN r.covered AND r.visitors = 0
          WHEN 'no-creation' THEN r.covered AND r.actions > 0 AND r."firstCreation" IS NULL
          WHEN 'quiet' THEN r.covered AND r.actions = 0 AND r."firstCreation" IS NOT NULL
          WHEN 'following' THEN r."following"
          WHEN 'mine' THEN r.mine
          ELSE true
      END
      AND (sqlc.narg(point_at)::timestamptz IS NULL OR CASE p.segment
          WHEN 'new' THEN r."createdAt" >= sqlc.narg(point_at) AND r."createdAt" < sqlc.narg(point_end)::timestamptz
          WHEN 'visited' THEN EXISTS (SELECT 1 FROM visit_days d WHERE d.workspace_id = r.id AND d.visit_day = (sqlc.narg(point_at) AT TIME ZONE 'Asia/Shanghai')::date)
          WHEN 'returning' THEN EXISTS (SELECT 1 FROM visit_days d WHERE d.workspace_id = r.id AND d.is_return AND d.visit_day = (sqlc.narg(point_at) AT TIME ZONE 'Asia/Shanghai')::date)
          ELSE EXISTS (SELECT 1 FROM events e WHERE e.workspace_id = r.id AND e.occurred_at >= sqlc.narg(point_at) AND e.occurred_at < sqlc.narg(point_end)
                           AND (p.segment <> 'creative' OR e.kind = 'creation'))
      END)
), paged AS (
    SELECT f.* FROM filtered f CROSS JOIN bounds p
    ORDER BY CASE WHEN p.segment IN ('mine', 'following') THEN f."dueOn" END NULLS LAST, CASE WHEN p.segment IN ('mine', 'following') THEN f."followupCreatedAt" END DESC NULLS LAST, f."createdAt" DESC, f.id DESC
    LIMIT 25 OFFSET sqlc.arg(page_offset)::integer
), event_days AS (
    SELECT (e.occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
           count(DISTINCT e.workspace_id) AS active, count(*) FILTER (WHERE e.kind = 'creation') AS creations,
           count(DISTINCT e.workspace_id) FILTER (WHERE e.kind = 'creation') AS creative,
           count(DISTINCT e.user_id) FILTER (WHERE e.origin = 'manual') AS members
    FROM events e CROSS JOIN bounds p WHERE e.occurred_at >= p.from_at GROUP BY 1
), daily_visits AS (
    SELECT visit_day AS day, count(DISTINCT workspace_id) AS worlds, count(DISTINCT user_id) AS visitors,
           count(DISTINCT workspace_id) FILTER (WHERE is_return) AS returning_worlds,
           count(DISTINCT user_id) FILTER (WHERE is_return) AS return_visitors
    FROM visit_days GROUP BY 1
), daily_new AS (
    SELECT (w.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day, count(*) AS worlds
    FROM worlds w CROSS JOIN bounds p WHERE w.created_at >= p.from_at AND w.created_at < p.to_at GROUP BY 1
), trend AS (
    SELECT d.day::date AS day, coalesce(n.worlds, 0) AS new, coalesce(v.worlds, 0) AS visited,
           coalesce(v.visitors, 0) AS visitors, coalesce(v.returning_worlds, 0) AS "returning",
           coalesce(v.return_visitors, 0) AS "returnVisitors", coalesce(e.active, 0) AS active,
           coalesce(e.members, 0) AS members, coalesce(e.creative, 0) AS creative, coalesce(e.creations, 0) AS creations
    FROM bounds p CROSS JOIN LATERAL generate_series(p.from_day::timestamp, p.to_day::timestamp, interval '1 day') d(day)
    LEFT JOIN daily_new n ON n.day = d.day LEFT JOIN daily_visits v ON v.day = d.day LEFT JOIN event_days e ON e.day = d.day
), games AS (
    SELECT c.game, count(*) FILTER (WHERE c.revision = 1) AS total,
           count(*) FILTER (WHERE c.revision = 1 AND c.occurred_at >= p.from_at) AS creations,
           count(*) FILTER (WHERE c.revision = 1 AND c.occurred_at >= p.from_at AND c.origin = 'mcp') AS mcp,
           count(*) FILTER (WHERE c.revision = 1 AND c.occurred_at >= p.from_at AND c.origin = 'manual') AS manual
    FROM creations c CROSS JOIN bounds p GROUP BY c.game
)
SELECT
    (SELECT count(*) FROM filtered)::bigint AS matched,
    (SELECT jsonb_build_object(
        'total', count(*), 'new', count(*) FILTER (WHERE "newWorld"),
        'visited', count(*) FILTER (WHERE visitors > 0), 'browsing', count(*) FILTER (WHERE covered AND visitors > 0 AND actions = 0),
        'returning', count(*) FILTER (WHERE "returning" > 0),
        'active', count(*) FILTER (WHERE actions > 0), 'creative', count(*) FILTER (WHERE creations > 0),
        'cohort', count(*) FILTER (WHERE "cohortEligible"),
        'first', count(*) FILTER (WHERE "cohortEligible" AND "firstCreation" < "createdAt" + interval '168 hours'),
        'covered', count(*) FILTER (WHERE covered)
    ) FROM rows)::jsonb AS totals,
    coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY CASE WHEN p.segment IN ('mine', 'following') THEN w."dueOn" END NULLS LAST, CASE WHEN p.segment IN ('mine', 'following') THEN w."followupCreatedAt" END DESC NULLS LAST, w."createdAt" DESC, w.id DESC)
              FROM paged w CROSS JOIN bounds p), '[]'::jsonb)::jsonb AS items,
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.day) FROM trend t), '[]'::jsonb)::jsonb AS trend,
    coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.game) FROM games g), '[]'::jsonb)::jsonb AS games,
    coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."occurredAt" DESC) FROM (
        SELECT e.game, e.kind, e.origin, e.occurred_at AS "occurredAt"
        FROM events e CROSS JOIN bounds p
        WHERE sqlc.narg(world_id)::uuid IS NOT NULL AND e.occurred_at >= p.from_at
        ORDER BY e.occurred_at DESC LIMIT 30
    ) a), '[]'::jsonb)::jsonb AS activity;

-- name: WorldOpsDiagnostics :one
SELECT
    (SELECT count(*) FROM mcp_activity m WHERE m.workspace_id = sqlc.arg(workspace_id) AND kind = 'call'
       AND occurred_at >= sqlc.arg(from_at)::timestamptz AND occurred_at < sqlc.arg(to_at)::timestamptz)::bigint AS calls,
    (SELECT count(*) FROM mcp_activity m WHERE m.workspace_id = sqlc.arg(workspace_id) AND kind = 'call' AND outcome IN ('error', 'blocked')
       AND occurred_at >= sqlc.arg(from_at)::timestamptz AND occurred_at < sqlc.arg(to_at)::timestamptz)::bigint AS failed,
    (SELECT count(*) FROM life_event e JOIN life_world w ON w.id = e.world_id WHERE w.workspace_id = sqlc.arg(workspace_id)
       AND e.occurred_at >= sqlc.arg(from_at)::timestamptz AND e.occurred_at < sqlc.arg(to_at)::timestamptz)::bigint AS simulation_events,
    EXISTS (SELECT 1 FROM life_world lw WHERE lw.workspace_id = sqlc.arg(workspace_id)) AS simulation_bound;

-- name: WorldOpsAdminCandidates :many
SELECT id, name FROM "user" WHERE lower(btrim(email)) = ANY(sqlc.arg(emails)::text[]) ORDER BY name, id;

-- name: ListWorldOpsFollowups :many
SELECT f.*, coalesce(u.name, '')::text AS assignee
FROM world_ops_followup f LEFT JOIN "user" u ON u.id = f.assignee_id
WHERE f.workspace_id = $1
ORDER BY f.closed_at IS NOT NULL, f.created_at DESC, f.id DESC
LIMIT 25 OFFSET sqlc.arg(page_offset)::integer;

-- name: ListWorldOpsFollowupEntries :many
SELECT e.*, coalesce(actor.name, '')::text AS actor, coalesce(owner.name, '')::text AS assignee
FROM world_ops_followup_entry e LEFT JOIN "user" actor ON actor.id = e.actor_id LEFT JOIN "user" owner ON owner.id = e.assignee_id
WHERE e.workspace_id = $1 AND e.followup_id = $2 ORDER BY e.version DESC
LIMIT 51 OFFSET sqlc.arg(page_offset)::integer;

-- name: CreateWorldOpsFollowup :one
INSERT INTO world_ops_followup (id, workspace_id, assignee_id, reason, due_on)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT DO NOTHING
RETURNING *;

-- name: UpdateWorldOpsFollowup :one
UPDATE world_ops_followup
SET assignee_id = sqlc.arg(assignee_id), due_on = sqlc.narg(due_on),
    closed_at = CASE WHEN sqlc.arg(close_followup)::boolean THEN now() ELSE NULL END,
    version = version + 1
WHERE workspace_id = $1 AND id = $2 AND version = sqlc.arg(expected_version) AND closed_at IS NULL
  AND (NOT sqlc.arg(close_followup)::boolean OR (assignee_id = sqlc.arg(assignee_id) AND due_on IS NOT DISTINCT FROM sqlc.narg(due_on)))
RETURNING *;

-- name: InsertWorldOpsFollowupEntry :exec
INSERT INTO world_ops_followup_entry (workspace_id, followup_id, version, actor_id, action, assignee_id, due_on, note)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: GetWorldOpsFollowupEntry :one
SELECT * FROM world_ops_followup_entry WHERE workspace_id = $1 AND followup_id = $2 AND version = $3;

-- name: DeleteWorkspaceOperations :exec
WITH visits AS (DELETE FROM world_ops_visit WHERE world_ops_visit.workspace_id = sqlc.arg(workspace_id)),
     actions AS (DELETE FROM world_ops_action WHERE world_ops_action.workspace_id = sqlc.arg(workspace_id)),
     entries AS (DELETE FROM world_ops_followup_entry WHERE world_ops_followup_entry.workspace_id = sqlc.arg(workspace_id))
DELETE FROM world_ops_followup WHERE world_ops_followup.workspace_id = sqlc.arg(workspace_id);
