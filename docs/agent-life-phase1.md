# Weavea Agent Life — Phase 1 implementation plan

## Requirement baseline

The request's Phase 1 task brief is the available requirement source. The user identified the full PRD in the ChatGPT conversation [设计自主Agent世界](https://chatgpt.com/g/g-p-6ae4458d02cc819184fa9e93a8e0eb71-weaveaworld/c/6ae44601-ba64-83e8-b075-750039172240). **The reader returned reply references without their text, and the browser remained on a waiting page; the full PRD has not been reviewed.** This document is an implementation plan, not a replacement PRD. Map layout, tuning, access policy and clock semantics below are explicit provisional choices to reconcile with that document.

Deliver the rules-only loop first: one simulation bound to one existing world/workspace, 20 preset residents, six actions, durable server authority and a live read-only viewer. LLM calls, resident creation, public profiles and diaries follow only after validating the simulation; they are not part of this initial implementation. No reproduction, combat, market, cross-world behavior or arbitrary execution.

## Technical differences and decisions

| Existing repository | Required addition / reuse |
| --- | --- |
| Go/Chi backend, PostgreSQL, sqlc, workspace membership | Keep Go authentication and reads; add `/api/life` inside the existing membership gate. No independent identity or public simulation write API. |
| Shared TypeScript core, React views, Next.js/Electron hosts | Put pure rules and strict planner contract in `packages/core/agent-life`; one shared viewer mounted at `/{slug}/life` on both hosts. |
| Existing Go task schedulers execute product tasks | Add a small Node TypeScript Worker in `apps/agent-life-worker`. Do not turn simulated residents into task-executing product agents. |
| Existing managed local environment | Add the opt-in `life` component and use the checkout's DATABASE_URL. Production requires a supervised worker alongside the API. |
| Existing WebSocket pipeline targets product entities | Phase 1 uses TanStack Query polling every 2 seconds with a consistent database snapshot. No simulated client clock or synthetic resident movement. SSE/WS is unnecessary at 20/60 residents. |

Brain receives a read-only observation and proposes a bounded action. The engine validates location, targets, available resources and current action, and owns every effect. Future LLM proposals must pass a strict schema (exported as JSON Schema) and the same engine validation. No model or network call occurs in a world transaction.

## Clock, actions and consistency

- One persisted Tick every 2 wall-clock seconds, representing one simulation minute. A long outage pauses simulation: restart advances from the last committed Tick, with no unbounded catch-up or invented offline results.
- Actions are durable `running` rows with start/due Ticks. MOVE travels one grid cell, REST restores energy, EAT consumes personal food, GATHER_WOOD transfers forest wood, WORK transfers farm food and earns a simple coin record, TALK restores both colocated residents' social need. No complex economic system.
- Each Tick begins a PostgreSQL transaction and locks the singleton world row with `FOR UPDATE`. Recheck database wall-clock eligibility **after** acquiring the lock. Competing workers serialize and cannot accelerate the clock.
- Complete due actions in a stable order, decay needs, score feasible next actions, save all resident/resource/action changes and append events, then advance the world clock in the same transaction. Any error rolls back the whole Tick.
- Action UUID plus unique terminal-event/action constraint prevents double settlement. A partial unique index allows at most one running action per resident. Resource CHECK constraints prohibit negative inventory; resident need bounds and time constraints defend persistence.
- Renewable forest/farm replenishment is bounded and recorded as its own environment event. Action events contain resource/need/position effects and decision reason. Completed actions have exactly one event, committed atomically.
- Twenty seeded residents have stable identities, personality weights and one modest resource goal. Capacity is capped at 60; do not build 60-agent product functionality yet.
- WORK is feasible only below eight personal food units. This prevents residents farming coins from stockpiling the communal food supply while hungry neighbors need it. The exact ration/yield is provisional tuning.

## Migration plan

All tables use the `life_` prefix, no foreign keys. Index builds are separate single-statement concurrent migrations, including identity indexes.

1. **574**: `life_world` (singleton, workspace, clock, next due time), `life_agent` (identity, traits, needs, location, goal), `life_resource` (world/owner/resource balance), `life_action` (durable command, reason, timing, status), `life_event` (Tick, action/actor, effects, timestamp).
2. **575–582**: unique world identity, singleton, resident identity, resource balance identity, action identity, resident/start-Tick command identity, running-action exclusivity, event/action identity.
3. **583–584**: chronological event and action lookup indexes.
4. Regenerate sqlc and validate migrations with the existing Go runner. Seed explicitly on Worker startup only when `AGENT_LIFE_WORKSPACE_ID` identifies an existing workspace; refuse accidental rebinding. Do not insert into existing worlds during migration.
5. Rollback: stop the worker first, reverse index migrations, then drop only life tables. This removes simulation data. Back up before any production rollout; production deployment is separate from local implementation.

## Tasks in dependency order

| Order | Task | Verification |
| --- | --- | --- |
| 1 | Shared observation/action/snapshot schemas and migration | Strict malformed planner/API payload tests; migrations and sqlc |
| 2 | Deterministic map, resident seed, rules Brain, six action executor | Need priorities, invalid targets/locations, depleted resources, long-run 20/60-resident invariants |
| 3 | Transactional store, Tick scheduler, graceful shutdown | Real PostgreSQL concurrent workers, replay, injected rollback, reconnect/restart and one event per completion |
| 4 | Authenticated Go read API, workspace isolation | Authentication/membership gates, missing world, cross-workspace reads, consistent response |
| 5 | Shared live map, residents/current action and event feed | Loading/error/stale states; real database-backed browser checks; Web/Desktop typechecks/builds |
| 6 | Managed startup, operational notes and acceptance evidence | Headless Worker runs without viewers, stop/restart without lost commits; report exact tests and limits |

## Deferred experiments

After rules acceptance, compare a bounded LLM planner with the baseline under the same seed/Tick budget. Measure survival, action/goal diversity, completion, latency and model cost. Persistent memory, growth mechanics and diary synthesis require the full PRD. Do not claim improved autonomy or long-term growth from merely adding an LLM call.

## Local operation

1. Use an existing workspace UUID (not its slug), and start `make up C=api,web,life MODE=development AGENT_LIFE_WORKSPACE_ID=<uuid>`. Alternatively put that UUID in this checkout's managed env file. Startup applies migrations and atomically seeds the single simulation once. It refuses a different workspace while a world exists.
2. Open `/{slug}/life` as a member of that workspace. Other worlds show an empty state; non-members cannot read the simulation. The sidebar and search expose the shared page on both Web and Desktop.
3. `make status` includes the `life` process; logs live with the checkout's other component logs. `make down ARGS="--components life"` stops just the Worker. `make down` stops the environment without deleting data. Restart uses committed state and durable due actions. A deleted workspace is swept transactionally and causes its Worker to stop.
4. Pure engine checks: `pnpm --filter @auro/core exec vitest run agent-life/engine.test.ts api/client-life.test.ts`. PostgreSQL checks: `make life-test-db` creates and drops random isolated schemas inside this checkout's configured database. No model or agent CLI is executed.
5. Build: `pnpm --filter @auro/agent-life-worker build`; run the resulting `dist/main.mjs` with Node and the Worker's declared production dependencies (`pg`, `zod`). The build bundles the shared TypeScript rules, so production never executes TypeScript source or browser code.
6. Explicit end-to-end acceptance, with API/Web started and no existing simulation: `pnpm --filter @auro/agent-life-worker build`, then `LIFE_E2E=1 pnpm exec playwright test e2e/agent-life.spec.ts`. The test uses TestApiClient fixtures and owns a temporary singleton, starts a real Worker without any viewer, checks real reads, kills/restarts the Worker, and deletes only its own fixture worlds. It refuses an existing simulation.

Production is not deployed by this change. A release must package the Worker bundle and production dependencies, configure the same Createx DATABASE_URL plus workspace UUID in a supervised service (`Restart=on-failure`, graceful SIGTERM), and start only after migrations. The current production deploy scripts do not install that additional service yet. Monitor world updated_at/Tick lag, worker errors and disk growth. Events are append-only; retention/partitioning requires a separate product/operational decision before extended production operation.

## Acceptance evidence and limits

- Pure rules: 20 and 60 residents each completed 1,440 Ticks (one simulated day), exercised all six actions, stayed within need bounds without reaching zero fullness, kept inventories nonnegative and produced one terminal event per settled action. This is accelerated simulation, not a 24-hour wall-clock soak.
- PostgreSQL: isolated-schema tests cover concurrent initialization and eight competing Tick callers (only one advances), an injected event-insert failure rolling back needs/resources/actions/clock together, pool reconnection with persisted pending actions, 72 Ticks of audit checks, duplicate event rejection, negative balance rejection and consistent workspace-filtered snapshot parsing.
- Browser: an actual compiled Worker advances before any viewer opens. The authenticated page reads 20 residents, its visible Tick advances, resident selection is URL-backed, other-workspace reads are denied, a SIGKILL/restart preserves committed Ticks, and desktop/narrow-screen map/detail/event access is verified. The same test hands the persisted world to `make up C=life`, verifies more Ticks, and stops the managed component. TestApiClient removes fixture worlds afterward.
- Verification commands also cover Go API/migrations and real-database workspace deletion, shared route and five-locale parity tests, relevant ESLint/typechecks, Worker build, Web production build and Electron main/preload/renderer build. Existing CSS `::highlight` optimizer warnings remain. Electron packaging/CLI bundling, full repository tests, mobile, real model calls and production deployment were not run for this change.
- Screenshots: `test-results/agent-life/world-desktop.png` and `test-results/agent-life/world-mobile.png` (local test outputs). The singleton is removed with the E2E fixtures; running the page in a real world requires the explicit workspace-bound startup above.
