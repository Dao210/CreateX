-- name: GetUser :one
SELECT * FROM "user"
WHERE id = $1;





-- name: GetUserByEmail :one
SELECT * FROM "user"
WHERE email = $1;





-- name: GetUsersByIDs :many
SELECT id, name, email, avatar_url FROM "user"
WHERE id = ANY(@ids::uuid[]);





-- name: CreateUser :one
INSERT INTO "user" (name, email, avatar_url)
VALUES ($1, $2, $3)
RETURNING *;





-- name: UpdateUser :one
UPDATE "user" SET
    name = COALESCE($2, name),
    avatar_url = COALESCE($3, avatar_url),
    language = COALESCE($4, language),
    profile_description = COALESCE(sqlc.narg('profile_description'), profile_description),
    timezone = CASE
        WHEN sqlc.narg('timezone')::text IS NULL THEN timezone
        WHEN sqlc.narg('timezone')::text = ''    THEN NULL
        ELSE sqlc.narg('timezone')::text
    END,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: MarkUserOnboarded :one
UPDATE "user" SET
    onboarded_at = COALESCE(onboarded_at, now()),
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: PatchUserOnboarding :one
UPDATE "user" SET
    onboarding_questionnaire = COALESCE(sqlc.narg('questionnaire'), onboarding_questionnaire),
    updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;





-- name: JoinCloudWaitlist :one
UPDATE "user" SET
    cloud_waitlist_email = $2,
    cloud_waitlist_reason = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: SetStarterContentState :one
UPDATE "user" SET
    starter_content_state = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;





-- name: SetUserPassword :one
UPDATE "user" SET password_hash = $2, updated_at = now()
WHERE id = $1
RETURNING *;
