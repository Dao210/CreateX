-- name: AdminStatsOverview :one
SELECT
    (SELECT count(*) FROM "user")::bigint AS total_users,
    (SELECT count(*) FROM "user" WHERE created_at >= now() - interval '1 day')::bigint AS new_users_1d,
    (SELECT count(*) FROM "user" WHERE created_at >= now() - interval '7 days')::bigint AS new_users_7d,
    (SELECT count(*) FROM "user" WHERE created_at >= now() - interval '30 days')::bigint AS new_users_30d,
    (SELECT count(*) FROM workspace)::bigint AS total_workspaces,
    (SELECT count(*) FROM workspace WHERE created_at >= now() - interval '1 day')::bigint AS new_workspaces_1d,
    (SELECT count(*) FROM workspace WHERE created_at >= now() - interval '7 days')::bigint AS new_workspaces_7d,
    (SELECT count(*) FROM workspace WHERE created_at >= now() - interval '30 days')::bigint AS new_workspaces_30d,
    (SELECT count(*) FROM member)::bigint AS total_members,
    (SELECT count(DISTINCT user_id) FROM client_usage_daily WHERE last_active_at >= now() - interval '1 day')::bigint AS active_users_1d,
    (SELECT count(DISTINCT user_id) FROM client_usage_daily WHERE last_active_at >= now() - interval '7 days')::bigint AS active_users_7d,
    (SELECT count(DISTINCT user_id) FROM client_usage_daily WHERE last_active_at >= now() - interval '30 days')::bigint AS active_users_30d,
    (SELECT count(DISTINCT daemon_id) FROM agent_runtime
        WHERE daemon_id IS NOT NULL AND last_seen_at >= now() - interval '1 day')::bigint AS active_daemons_1d,
    (SELECT count(*) FROM workspace_invitation WHERE status = 'pending')::bigint AS pending_invitations
FROM (SELECT 1) seed;





-- name: AdminStatsUserTrend :many
WITH days AS (
    SELECT generate_series(@since::date, (now() AT TIME ZONE @tz::text)::date, interval '1 day')::date AS day
)
SELECT d.day AS day, count(u.id)::bigint AS value
FROM days d
LEFT JOIN "user" u ON (u.created_at AT TIME ZONE @tz::text)::date = d.day
GROUP BY d.day
ORDER BY d.day;





-- name: AdminStatsWorkspaceTrend :many
WITH days AS (
    SELECT generate_series(@since::date, (now() AT TIME ZONE @tz::text)::date, interval '1 day')::date AS day
)
SELECT d.day AS day, count(w.id)::bigint AS value
FROM days d
LEFT JOIN workspace w ON (w.created_at AT TIME ZONE @tz::text)::date = d.day
GROUP BY d.day
ORDER BY d.day;





-- name: AdminStatsDauTrend :many
WITH days AS (
    SELECT generate_series(@since::date, (now() AT TIME ZONE @tz::text)::date, interval '1 day')::date AS day
)
SELECT d.day AS day,
       count(DISTINCT c.user_id)::bigint AS total,
       count(DISTINCT c.user_id) FILTER (WHERE c.client_type = 'web')::bigint AS web,
       count(DISTINCT c.user_id) FILTER (WHERE c.client_type = 'desktop')::bigint AS desktop
FROM days d
LEFT JOIN client_usage_daily c ON (c.first_active_at AT TIME ZONE @tz::text)::date = d.day
GROUP BY d.day
ORDER BY d.day;





-- name: AdminStatsInvitations :many
SELECT status, count(*)::bigint AS value
FROM workspace_invitation
GROUP BY status;





-- name: AdminStatsMemberRoles :many
SELECT role, count(*)::bigint AS value
FROM member
GROUP BY role;





-- name: AdminStatsWorkspaceSizes :many
SELECT bucket, count(*)::bigint AS value
FROM (
    SELECT CASE
        WHEN count(m.id) = 0 THEN '0'
        WHEN count(m.id) = 1 THEN '1'
        WHEN count(m.id) <= 4 THEN '2-4'
        ELSE '5+'
    END AS bucket
    FROM workspace w
    LEFT JOIN member m ON m.workspace_id = w.id
    GROUP BY w.id
) sizes
GROUP BY bucket;
