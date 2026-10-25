-- Doodle Siege, workspace-scoped storage (docs/siege-integration-plan.md).
--
-- Siege used to keep one JSON file per session under .siege/sessions/, keyed by
-- an anonymous siege_owner cookie. Joining Auro means the same rows have to be
-- scoped to a workspace member, so the ownership key becomes (workspace_id,
-- user_id) and the whole session document moves into a jsonb payload.
--
-- The payload keeps the existing Go domain shape on purpose: Service reads and
-- writes one whole session at a time (blueprints, recognition receipts and save
-- receipts always travel together), so splitting blueprints into their own
-- table would buy nothing and would force a rewrite of the optimistic-version
-- and idempotency-receipt logic.
--
-- No foreign keys: workspace and user deletion are application-owned and sweep
-- these tables explicitly, matching issue_child_event and search_index_change.
CREATE TABLE IF NOT EXISTS siege_session (
    id           UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    user_id      UUID NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listing a member's sessions is the only cross-session query we run.
CREATE INDEX IF NOT EXISTS siege_session_owner
    ON siege_session (workspace_id, user_id, updated_at DESC);

-- Daily vision-recognition budget, per member. Mirrors the single global
-- counter the file store kept in budget.json, but scopeable so one workspace
-- cannot exhaust another's allowance.
CREATE TABLE IF NOT EXISTS siege_recognition_budget (
    workspace_id UUID NOT NULL,
    user_id      UUID NOT NULL,
    day          DATE NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, user_id, day)
);
