# Repository Instructions

Auro is a task management platform where people and agents collaborate on issues. These instructions apply to all coding agents working in this repository.

## Scope and Reading Order

- Before changing `apps/mobile/`, also read [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md), even if your tool does not load nested instructions automatically. Platform-specific sections below apply only to the named platform.
- For naming, translations, or Chinese UI/docs copy, follow [UI Copy](#ui-copy) and keep terminology aligned with the surrounding UI and locale files.
- Maintain shared rules here and mobile-specific rules in the mobile file. `CLAUDE.md` files only import them. Update instructions in the same change that alters the referenced workflow or boundary; do not add incident timelines, dependency version lists, or duplicate rules.

## Sharing Rules and Package Boundaries

| Location | Responsibility and constraints |
| --- | --- |
| `server/` | Go backend; Chi, sqlc, WebSocket |
| `packages/core/` | Headless logic, API client, Query hooks, shared Zustand stores. No UI libraries, `react-dom`, `localStorage`, or `process.env`; use `StorageAdapter` for persistence. |
| `packages/ui/` | UI primitives and shared styles. No business logic or `@auro/core` imports. |
| `packages/views/` | Shared web/desktop pages and business components. No store definitions, `next/*`, or `react-router-dom`; use `NavigationAdapter`, `useNavigation()`, and `<AppLink>`. |
| `apps/web/` | Next.js routes/layouts and web-only UI. Framework APIs stay here; shared navigation adapters live in `apps/web/platform/`. |
| `apps/desktop/` | Electron and desktop-only UI/state. Application navigation goes through `apps/desktop/src/renderer/src/platform/`. |
| `apps/mobile/` | Independent Expo/React Native client: owns UI, state, hooks, providers, i18n, build, and release. Shares core types and pure utilities, including platform-independent schemas. |
| `docs/` | Architecture, integration, and operational documentation; shared component contracts live in `packages/ui/docs/`. |

- Dependency direction is `views -> core + ui`; core and ui remain independent. Shared packages export raw TypeScript compiled by consuming apps.
- Extract logic used by both web and desktop into the appropriate shared package. Keep framework/Electron APIs in the app layer; inject platform-specific UI through props/slots.
- Wire shared features into both web routes and the desktop router or overlay. Reuse existing guards/providers such as `DashboardGuard` in `packages/views/layout/`.
- Public game marketing pages (`/`, `/about`) render in `apps/web/app/(landing)` without application providers. Authenticated/product routes share `app/(application)/layout.tsx`; inherited product marketing pages use `(landing)/(legacy)`. Keep auth, realtime, chat stores and full product locale dictionaries out of public game pages; only the visible world preview hydrates and polls.
- Each workspace declares its directly imported external dependencies. Use `catalog:` for shared dependencies; mobile pins Expo/React Native dependencies in its own manifest.

## Development and Verification

Use `Makefile`, workspace `package.json` files, and `pnpm-workspace.yaml` for current commands and versions. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and worktree operations.

- Use the exact package manager declared by root `package.json`. pnpm settings, dependency overrides, and explicit dependency build approvals live in `pnpm-workspace.yaml`; `.npmrc` is only for registry and authentication. Run an explicit frozen install when dependency checks report a stale installation. CI installs the native package manager from the root declaration and uses frozen installs. Docker offline installs must carry both the package store and policy metadata cache from the online stage.
- Use the checkout's managed environment: `make up`, `make status`, `make down`. `make down` preserves data; `make destroy` removes the environment and its data.
- Use `make up MODE=production` for daily local use and `make up MODE=development` for hot reload. The checkout remembers the selected Web mode; `make status` reports the running mode. Production builds use `.next-local` and are reused only while source and build inputs match. Start a single Web development task directly through pnpm, without a persistent Turbo wrapper.
- User-facing workspaces are "worlds". First-run `/onboarding` reuses an existing world or creates one with a localized nickname-based name and an independent generated slug, completes onboarding, then enters the world. Save that default name once; profile changes, locale changes and other members must not rename it. Preserve existing names and manual naming in `new_workspace` mode; first-run entry does not require a questionnaire, runtime connection, or Mika bootstrap. Technical workspace identifiers and permission boundaries remain unchanged.
- The `issues`, `projects`, `my-issues`, and `squads` route families are retired on Web, Desktop, and Mobile. Keep their slugs reserved and discard persisted destinations. Web/Desktop workspace entry defaults to `/{slug}/me`. Do not restore retired pages, navigation, or redirects.
- Local startup (`make dev`, `make up`, `make setup`, `make start`) connects directly through `DATABASE_URL` and requires PostgreSQL client tools, not Docker. The preflight may create a missing local database using the same credentials; remote databases must already exist. Docker PostgreSQL is opt-in with `make db-up`.
- DEAL is an independent game in `apps/deal` and `server/internal/deal`, served at `/deal`. Use `make up C=deal`, `make status C=deal`, and `make down C=deal`; its single-instance file data and logs live in `.deal/`, without Auro accounts or PostgreSQL. `DEAL_MODEL_MODE=scripted` explicitly selects rule practice, never an automatic model fallback. Verify with `pnpm --filter @auro/deal typecheck`, `pnpm --filter @auro/deal lint`, `pnpm --filter @auro/deal test`, `pnpm --filter @auro/deal build`, and `(cd server && go test ./internal/deal ./cmd/deal ./pkg/llm)`. Browser tests use `pnpm exec playwright test --config apps/deal/playwright.config.ts` against an explicitly started scripted environment, with independent fixtures in `e2e/deal/`. Shared Auro page wiring rules do not turn this standalone product into an Auro workspace feature.
- Doodle Siege is a first-level workspace feature at `/{slug}/siege` (workshop) and `/{slug}/siege/campaign` on Web and Desktop. Web mounts both inside `(dashboard)`. Use the main application's `make up`, build and release workflow; do not add a standalone app, server, anonymous identity or file-store mode. `server/internal/siege` owns `/api/siege` under workspace membership. `SIEGE_RECOGNITION_MODE=fixture` recognizes only the shipped samples and is explicitly enabled for recognition regressions; normal gameplay and manual confirmation work without AI. See [docs/siege-integration-plan.md](docs/siege-integration-plan.md).
- `/{slug}/me` is "My Creations" for the current world member, with separate creations and game-progress tabs and an explicit current-world label. Keep tab/filter selections in the URL; it is not an account-wide resource library or profile page. It aggregates the user's Siege blueprints (`GET /api/siege/library`) and Tank characters (`GET /api/tanks/v1/characters?mine=1`) without duplicating content; MCP-created tanks carry `origin: "mcp"`. Monotonic progress (Siege stars, Tank best/unlocked) syncs through `server/internal/gameprogress` and `game_progress`; sound, difficulty, checkpoints and loadouts stay device-local. The server stores client-reported personal records only; do not present them as ranked or server-verified results.
- Siege definitions, geometry, economy, targeting and checkpoint validation belong in `packages/core/siege`; Rapier, Canvas and audio belong in `packages/views/siege`. Hosts inject storage, and user/workspace UUIDs scope preferences and IndexedDB drafts; identity changes remount the game. Public page entry points must not statically import physics. Shared images live in `packages/views/siege/assets`, resolved by the host bundler. Deployment freezes compiled blueprints; restore completed-wave checkpoints rather than physics worlds. Verify core/view Siege tests, Web/Desktop checks and builds, Go Siege tests (`SIEGE_TEST_DATABASE_URL` enables fixture-scoped PostgreSQL cases), and authenticated `pnpm exec playwright test e2e/siege` against the main application.
- Siege cannon kits generate geometry and part definitions deterministically from versioned dimensions in `packages/core/siege`; kit drafts and freehand drafts are separate. Reuse the weapon compiler and battle runtime, and validate saved kit parameters against their generated drawing/spec. Defense victory requires all waves to spawn and the remaining enemies to clear.
- Tank defense is a first-level workspace feature at `/{slug}/tanks` on web and desktop. Web mounts it inside `(dashboard)`; the shared sidebar, route registry and search expose its own entry. DOM-free maps, blueprints and fixed-step rules live in `packages/core/tank-defense`; Canvas and input live in `packages/views/tank-defense`, with shared synthesized audio in `packages/views/common/game-sound.ts`. Hosts inject `StorageAdapter`; local progress keys include user and workspace UUIDs, and identity changes remount the battle. Keep it independent of Siege and AI configuration. Classic characters use `tank-defense@1`, not the proposed general `ground2d@1` contract: `server/internal/tanks` owns versioned characters, frozen sessions and `/api/tanks/mcp`; `auro tanks mcp` supplies the stdio transport with existing CLI/task credentials. The default “Connect Agent” action copies installation instructions for the bundled Node connector and guide in `apps/web/public/.well-known/tanks-mcp/`; keep manual CLI configuration collapsed. Connector setup uses the existing browser login/PAT flow, isolates credentials by API/world/account, and verifies the account plus read-only catalog before registration; copied instructions and MCP configuration must not contain tokens. The tank connector's local callback returns the browser to the membership-resolved world only after saving the verified credential; the Agent continues client registration and actual catalog verification independently. A browser return or `gameUrl` is not proof of client readiness; character-specific play uses the saved character's frozen-session `playUrl`. The canonical catalog is `packages/core/tank-defense/character-catalog.json`; run `pnpm generate:tank-contracts` after changes. Do not accept agent-supplied combat stats or replace invalid sessions with presets. Permanent character experience belongs to the character ID in `tank_character.experience`, survives design revisions, and uses the versioned progression rules in the same canonical catalog. Owned-character training registers once before a round and settles once through `/api/tanks/v1/sessions/{id}/runs`; retries reuse the run identity. These remain client-reported personal records. Freeze experience plus the grown loadout at deployment; the nine-point base design/hash stays unchanged. Local difficulty assists modify runtime rules, not compiled or frozen character blueprints. Game fullscreen keeps the live battle mounted and pauses on exit. See [docs/tank-character-mcp.md](docs/tank-character-mcp.md). Verify tank core/view/API tests, paths/navigation/locales, web/desktop checks, Go tank/CLI tests, and authenticated `e2e/tanks.spec.ts` plus `e2e/tanks-mcp.spec.ts`.
- Worktrees share PostgreSQL but have isolated databases/ports. Use the environment scripts and `.env.worktree`; do not copy the main checkout's `.env` or manually create a database through an assumed PostgreSQL instance.
- Native production deployment to `auro` uses `scripts/deploy-createx.sh` and isolated Createx resources; see [docs/deploy-auro.md](docs/deploy-auro.md). Do not reuse another application's database, credentials, ports, service units or deployment directories.
- Agent Life is a single server-authoritative simulation bound to an existing world via `AGENT_LIFE_WORKSPACE_ID`. Pure TypeScript rules and planner schemas live in `packages/core/agent-life`; the PostgreSQL writer and scheduler live in `apps/agent-life-worker`. Go serves membership-gated read-only `/api/life` snapshots; the shared viewer is `/{slug}/life` on Web/Desktop. Start with `make up C=api,web,life`; `make down` preserves simulation state. Run core Agent Life tests and `make life-test-db` (disposable schemas), plus Worker/Web/Desktop checks. See [docs/agent-life-phase1.md](docs/agent-life-phase1.md). Do not connect simulated residents to product-agent task execution or enable LLM calls in the rules-only phase.
- Global MCP administration is `/admin` on web and a window overlay on desktop. Only human accounts listed in server-side `AURO_ADMIN_EMAILS` may use `/api/admin/*`; workspace owner/admin roles do not grant global access. `server/internal/mcpadmin` owns the service registry, persisted global policies, call metadata and policy audit. MCP transports enforce the same policy on each request; game HTTP APIs remain independent. Register new provided MCP services in `server/cmd/server/mcp_admin.go`; outbound workspace MCP libraries keep their existing workspace permissions and write-only secrets. See [docs/mcp-admin.md](docs/mcp-admin.md).
- Regenerate sqlc with `make sqlc` after SQL changes.
- Run the narrowest useful checks while iterating, then broaden when risk warrants it. Report what actually ran and any skipped checks.

Run these from the repository root:

| Scope | Checks |
| --- | --- |
| Frontend excluding mobile | `pnpm typecheck`, `pnpm lint`, `pnpm test` |
| Go backend | `make test` |
| End-to-end | `pnpm exec playwright test` |
| Combined web/backend verification | `make check` |
| Mobile | Commands in [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md#verification) |

Root frontend commands and `make check` do not verify mobile. Docs-only changes can use link/reference checks and `git diff --check`; state that code tests were not run.

## State Rules

- TanStack Query owns API/server data. Zustand owns client state such as filters, drafts, modals, and tab layout; persist only durable preferences/drafts/layout, not server data or ephemeral UI state.
- Web/desktop shared stores live in `packages/core/`. Desktop platform stores remain in desktop; mobile stores remain in mobile. Do not define stores in `packages/views/`.
- On web/desktop, workspace identity is route-driven; platform mirrors exist only for request headers, storage namespaces, and reconnects. React Context is for platform plumbing, not a second server-state store.
- Among stores, only auth/workspace stores may call `api.*` directly; other server interactions belong in queries/mutations.
- Workspace-scoped query keys include `wsId`; account-level keys remain account-scoped. Hooks needing workspace context accept `wsId` unless guaranteed to run under its provider.
- Zustand selectors return stable references; use shallow comparison for allocated objects/arrays.
- WebSocket events patch or invalidate Query caches, not server payloads in Zustand. Clearing client-owned pointers is allowed with one responder and a self-initiated guard when this client can cause the event.
- Optimistic field patches require a predictable result, rare failure, trivial rollback, and staying on the current screen. Snapshot before patching, roll back on failure, and invalidate uncertain projections on settle.
- Create/delete/leave and confirmation flows await the server before navigation or cleanup; do not optimistically delete entities. Exceptions: the existing workspace-leave race noted under Desktop Rules, and mobile inbox mark-read as documented in its instructions.
- Message sends use visible pending state and retry on failure.

## API Compatibility

Installed desktop clients may talk to newer backends. Preserve response compatibility at the API boundary.

- UI-consumed JSON passes through a zod schema and `parseWithFallback`, not an `as T` cast. Web/desktop use `packages/core/api/schema.ts`; mobile uses its own request helpers.
- Provide defaults for optional fields and fallbacks for unknown server enums. Prefer explicit boolean checks; avoid tying critical affordances to a single backend flag when other contract signals are available.
- When adding/changing an endpoint, update its schema and malformed-response tests.

## Database and Migration Rules

- Do not add foreign keys, cascading deletes, or cascading updates. Validate relationships and clean up dependents in application code, using a transaction when the operation must be atomic.
- Every migration-created index, including indexes on new tables, uses `CREATE [UNIQUE] INDEX CONCURRENTLY`. Each concurrent index build gets its own single-statement migration file; the runner executes files outside an explicit transaction.
- Conditionally skipped migrations are still recorded in `schema_migrations`. Later DDL touching conditional objects must be idempotent (`IF EXISTS` / `IF NOT EXISTS`); document recovery if the missing object would break runtime behavior.

## Backend UUID Rules

In `server/internal/handler/`, distinguish UUID sources before using them in writes:

- UUID-or-human-readable resource params: resolve with loaders such as `loadIssueForUser`, `loadSkillForUser`, `loadAgentForUser`, or `requireDaemonRuntimeAccess`, then write using the resolved `entity.ID`.
- Pure UUID request input: `parseUUIDOrBadRequest(w, s, fieldName)`; return immediately when `ok=false`.
- Trusted sqlc/test-fixture round-trips: `parseUUID(s)`, which panics on invalid input.
- Outside handlers: `util.ParseUUID(s)` and check the error.

Workspace-scoped queries filter by `workspace_id`; membership gates access and `X-Workspace-ID` selects the workspace. Assignees are polymorphic: interpret `assignee_id` together with `assignee_type`.

## Desktop Rules

- Workspace session routes are tab destinations. Pre-workspace one-shot flows (create workspace, accept invite) use `WindowOverlay` in `apps/desktop/src/renderer/src/stores/window-overlay-store.ts`, not new routes. Stale workspace tabs heal by dropping stale tab groups.
- Workspace route layouts own `setCurrentWorkspace(slug, uuid)` from `@auro/core/platform`; leaving workspace context calls `setCurrentWorkspace(null, null)`.
- Cross-workspace navigation uses the adapter's `switchWorkspace(slug, targetPath)` flow; do not bypass it with direct router navigation.
- Workspace delete awaits the server. Existing workspace leave clears/navigates first to avoid the `member:removed` race; this is known debt in `packages/views/settings/components/workspace-tab.tsx`, not a pattern for new flows.
- Full-window views outside the dashboard shell mount `<DragStrip />` from `@auro/views/platform` as the first flex child. Interactive controls in the top 48px need `WebkitAppRegion: "no-drag"`.

## UI Copy

- Descriptions are optional and omitted by default. Do not restate titles, labels, values, statuses, or button actions. Add help only for a non-obvious choice, constraint, consequence, or next step; state each fact once beside the relevant control.
- Keep permissions, cost, destructive consequences, execution prerequisites, and error recovery visible when relevant. Put advanced usage and diagnostics in accessible, explicit help. Preserve labels and accessible names; do not move redundant prose wholesale into `sr-only` text.
- Review copy with its surrounding controls and all supported translations, including mobile's independent copy. A description prop is not a requirement to write a paragraph.

## Web/Desktop UI Rules

- For Button and Dialog usage, read `packages/ui/docs/button.md` and `packages/ui/docs/dialog.md`.

- Prefer existing shadcn/Base UI primitives. Add components with `pnpm ui:add <component>`.
- For `pnpm ui:add @reui/<name>`, decline overwrite prompts. Keep `REUI_LICENSE_KEY` in the environment, never in repo files. Adapt vendored primitives into `packages/ui/components/ui/` and compositions into `packages/views/`.
- Use shared semantic tokens in `packages/ui/styles/`. Typography uses the role-named `--text-*` scale in `packages/ui/styles/tokens.css`, not Tailwind's default size ramp.
- Selected states remain identifiable on hover. Handle overflow, long text, and scrolling deliberately; avoid unnecessary local state and dividers.

## Testing

- Tests live beside their implementation: shared logic in core, shared components in views, platform wiring in apps, E2E in `e2e/`, Go tests in server. Do not test shared behavior in app suites.
- Give each behavior one canonical test layer: helper tests own parsing/state matrices; component tests cover wiring, accessibility, happy paths, and named regressions. Prefer a failing regression test before behavioral fixes.
- DOM-free `.test.ts` files start with `// @vitest-environment node`; do not use it if it would silently switch the code under test to an SSR path.
- Views tests must not mock `next/*` or `react-router-dom`. Mock stores with their Zustand callable shape plus `getState`; mock API calls at `@auro/core/api`.
- E2E setup/teardown uses `TestApiClient`.
- DB-backed Go tests use `server/internal/testutil` fixtures (`dbfx.Issue`, `dbfx.Task`, `dbfx.Insert`) and `testutil.Call(h, req).Want(status).JSON(&out)`. Keep product assertions and case-specific diagnostics in the test, not fixture helpers.
- Default tests must not resolve or execute user-installed agent CLIs; pass test-created fake or missing executable paths. New default agent commands go in `scripts/agent-cli-command-names.txt`.
- Only run real-agent smoke tests when explicitly authorized. Gate them behind `agentintegration` and check `AURO_RUN_REAL_AGENT_SMOKE=1` before executable lookup/account access. Run the specific test: `(cd server && AURO_RUN_REAL_AGENT_SMOKE=1 go test -tags=agentintegration ./pkg/agent -run '<test-name>' -count=1 -v)`.

## Change and Delivery Rules

- Keep changes scoped; reuse existing patterns. Code comments are English.
- Do not add internal compatibility shims, dual writes, fallback paths, or legacy adapters unless requested. This does not relax API response compatibility above.
- New global pre-workspace routes use a single word or `/{noun}/{verb}`, not hyphenated root names. Update `server/internal/handler/reserved_slugs.json`, run `pnpm generate:reserved-slugs`, and commit `packages/core/paths/reserved-slugs.ts` when changing reserved slugs.
- Use atomic conventional commits and the repository PR template. For releases, follow [.github/RELEASING.md](.github/RELEASING.md); default to a patch bump unless specified otherwise.
