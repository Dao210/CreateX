-- The worker owns writes; the existing Go API serves workspace-authorized reads.
CREATE TABLE IF NOT EXISTS life_world (
 id UUID NOT NULL, singleton BOOLEAN NOT NULL DEFAULT true CHECK (singleton),
 workspace_id UUID NOT NULL, tick BIGINT NOT NULL DEFAULT 0 CHECK (tick >= 0),
 tick_ms INTEGER NOT NULL DEFAULT 2000 CHECK (tick_ms BETWEEN 100 AND 60000),
 next_tick_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS life_agent (
 world_id UUID NOT NULL, id UUID NOT NULL, name TEXT NOT NULL,
 x INTEGER NOT NULL CHECK (x BETWEEN 0 AND 11), y INTEGER NOT NULL CHECK (y BETWEEN 0 AND 7),
 energy INTEGER NOT NULL CHECK (energy BETWEEN 0 AND 100),
 fullness INTEGER NOT NULL CHECK (fullness BETWEEN 0 AND 100),
 social INTEGER NOT NULL CHECK (social BETWEEN 0 AND 100),
 personality JSONB NOT NULL, goal JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS life_resource (
 world_id UUID NOT NULL, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('food','wood','coins')),
 amount INTEGER NOT NULL CHECK (amount >= 0)
);
CREATE TABLE IF NOT EXISTS life_action (
 world_id UUID NOT NULL, id UUID NOT NULL, agent_id UUID NOT NULL,
 intent JSONB NOT NULL CHECK (intent->>'kind' IN ('MOVE','REST','EAT','GATHER_WOOD','WORK','TALK')),
 reason TEXT NOT NULL, started_tick BIGINT NOT NULL CHECK (started_tick >= 0),
 due_tick BIGINT NOT NULL CHECK (due_tick > started_tick),
 status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
 completed_tick BIGINT CHECK (completed_tick >= due_tick),
 CHECK ((status = 'running' AND completed_tick IS NULL) OR (status <> 'running' AND completed_tick IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS life_event (
 world_id UUID NOT NULL, id UUID NOT NULL, tick BIGINT NOT NULL CHECK (tick >= 0),
 action_id UUID, agent_id UUID, kind TEXT NOT NULL, payload JSONB NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
