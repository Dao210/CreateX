# Weavea Agent Life — integrated Phase 1

## Requirement baseline

The Phase 1 task brief is the available requirement source. The linked [完整 PRD 聊天](https://chatgpt.com/g/g-p-6ae4458d02cc819184fa9e93a8e0eb71-weaveaworld/c/6ae44601-ba64-83e8-b075-750039172240) did not expose its reply text through the reader or browser. Map dimensions, clock ratio and yields remain provisional until that text is available.

The rules-only scope remains one simulation bound to one existing world, 20 preset residents and six actions. The pure engine supports tests at 60 residents. LLM planning, resident creation, diaries, combat, reproduction, markets and cross-world behavior are deferred.

## Ownership

| Location | Responsibility |
| --- | --- |
| `packages/core/agent-life/engine.ts`, `rules.ts`, `brain.ts` | TypeScript world rules and independent Brain; no persistence or framework APIs |
| `packages/core/agent-life/runtime-contract.ts` | Strict, bounded versioned compute request/result schema |
| `server/internal/life/runtime/bridge.ts` | Persistent stdin/stdout JSON compute host; bundled with its dependencies |
| `server/internal/life/runtime.go` | Go child lifecycle, credential-free environment, frame limit, timeout, strict response identity and restart |
| `server/internal/life/repository.go` | Shared pgx pool, sqlc, initialization and atomic Tick/event/inbox persistence |
| `server/internal/life/service.go` | Background scheduling, stale-result rejection, commit notifications and shutdown |
| `packages/views/agent-life` | Shared Web/Desktop viewer, route-driven world and selection |

There is no independent Life application, database client, HTTP listener, service unit or launch component. Main API startup owns the compute process. Resident Life keeps existing membership and game-access guards. Game availability affects access and message projection; it does not stop the simulation.

## Tick and transaction boundary

1. Read the persisted binding and database due time. Load a single MVCC snapshot of residents, resources and running actions.
2. Compute the next Tick in TypeScript outside the database transaction. The host has no DATABASE_URL, account or model credentials. It exposes only seed and tick operations; no arbitrary code or task execution.
3. Begin the write transaction. Lock the workspace, then its life world, matching the workspace-delete fence. Check the input Tick still matches and recheck database wall-clock eligibility after locking.
4. Validate resident/inventory identity, bounded needs/resources, action projections and one terminal event per settled action. Store completed/new actions, residents, resources, events and source inbox facts through sqlc.
5. Advance the clock and commit together. Only then publish `life:updated` through the existing event bus/realtime broadcaster. A stale result is discarded; failed computation or SQL advances nothing.

Actions retain their UUIDs, start/due Ticks and status. Existing resident goal milestone IDs retain the previous deterministic hash, so writer cutover preserves notification identity. SQL uniqueness and nonnegative-balance constraints remain authoritative.

The interval is 2 wall-clock seconds per simulation minute. Downtime pauses progress; restart continues committed state without unbounded catch-up. MOVE travels one grid cell; REST recovers energy; EAT consumes inventory; GATHER_WOOD transfers forest stock; WORK transfers farm food and earns a simple coin; TALK affects colocated residents. Food-stock limits prevent goal-driven hoarding. Rules are implemented once in TypeScript.

## Startup, shutdown and cutover

- Build with `make life-build` or `pnpm build:life`. Output is `server/bin/runtime/life/engine.mjs`, including Zod; production requires Node >=22 and no node_modules for this compute bundle.
- `make up` starts the API with its internal runtime. `make start`, `make dev` and `make server` use the same API target and build the runtime automatically. Existing worlds resume from `life_world`.
- To initialize the first simulation, explicitly identify an existing world: `make up AGENT_LIFE_WORKSPACE_ID=<uuid>`. Initialization requires a main-service restart if the API is already running. Startup rejects a different persisted binding and never chooses a user's world implicitly. There is no new admin start/reset/rebind interface.
- `AGENT_LIFE_ENGINE_PATH` is an operational override. The default resolves `runtime/life/engine.mjs` beside the actual server executable; resolving the release path prevents a web-only switch from changing the running backend's runtime version.
- Before upgrading an old checkout, stop its standalone Life component with that checkout's old management command. Main-service startup rejects an existing PostgreSQL session bearing the old writer's application name. Never run the old writer alongside the new owner.
- `make down` cancels scheduling, joins the in-flight Tick and compute child before closing the database pool, and preserves committed data. A dead compute process is reaped and recreated on the next attempt; failed attempts do not commit.
- `/health` includes the Life component state; `/readyz` distinguishes uninitialized/running from starting/error/stopped. Persisted updated_at and Tick lag remain world observations, not proof of process health.

## Frontend and existing product services

The existing `/{slug}/life` page and `/api/life` read contract stay in place. Realtime commit notifications invalidate the world-scoped TanStack Query cache. A 30-second reconciliation interval and reconnect/focus refresh recover missed notifications. The client never runs the clock or settles actions.

Goal facts enter `world_inbox_event` in the Tick transaction and use the existing inbox projector. Closing a game does not delete state or stop the simulation. Workspace deletion takes the same lock order and cleans up the Life tables in its application transaction. Product-agent schedulers, CLIs and runtime credentials are not used for simulated residents.

## Build and delivery

- `make build` builds the runtime with server/CLI/migrate binaries. Root build/typecheck include the internal TypeScript entry point.
- Native Createx full releases package `bin/runtime/life/engine.mjs` with the matching backend. Web-only releases preserve the whole backend bin directory, including its runtime. Release pruning also retains the running API's actual release, so repeated web-only updates cannot delete the bundle needed for compute-process recovery. The host rejects incomplete artifacts. No additional systemd unit is installed.
- Docker builds the same self-contained compute bundle and includes Node in the backend runtime image.
- Backend CI builds the engine before Go tests and runs the isolated PostgreSQL Life tests. Shared Life rules, build script and dependency lock changes select backend verification.
- Database tables and the current migration baseline are preserved. No retired migrations are added or replayed. Future simulation write paths must join the Tick version/locking protocol before being enabled.

## Verification

- `pnpm --filter @auro/core exec vitest run agent-life api/client-life.test.ts`: rules, malformed data and bounded runtime contract. The 1,440-Tick runs are accelerated simulation, not a 24-hour wall-clock soak.
- `make life-test-db`: builds the real compute host, then runs Go race tests using disposable schemas. Covers concurrent initialization/commit, stale results, event/inbox rollback, process crash/recovery, workspace isolation and deletion.
- Main-service tests cover protocol, timeouts, environment isolation, shutdown and health. Database cases require the explicit fixture environment.
- With API/Web started in a disposable managed checkout: `LIFE_E2E=1 pnpm exec playwright test e2e/agent-life.spec.ts`. It refuses an existing simulation, creates TestApiClient fixtures, restarts the API, kills its compute child, checks websocket-driven Ticks and removes fixture worlds.
- Run Web/Desktop checks/builds, lifecycle/deploy/CI-scope scripts and inbox/game-admin regressions for shared integration changes.

Do not run the restart E2E against a shared daily or production environment. Production deployment and a long wall-clock soak are separate acceptance steps.
