# World operations

Web Admin exposes `/admin/worlds` and `/admin/worlds/{workspaceId}`. Desktop
exposes the same module in the global Admin overlay. The overview and world
list use the same metric definitions. Metric and chart drill-downs carry the
selected date range and cutoff into the list and world details.

## Metric coverage

- Visits are observed when a world page is visible and focused in a supported
  Web or Desktop client. A world, member and Asia/Shanghai calendar day form
  one visit record. A returning member has a visit on at least two dates in the
  selected interval. The daily trend shows visits after the first recorded day
  for that world and member within the interval.
- World activity includes saved creations, revisions, advances in synchronized
  game progress and fish releases. Only known member actions count toward
  active-member totals. Fish releases recorded through retry receipts have an
  unknown actor source. Progress remains client-reported.
- Creation history uses timestamps on authoritative Tank and Fish revisions
  and saved Siege blueprints. New creations count once per game and work ID.
  Malformed or missing creation timestamps do not contribute to trends.
- The seven-day first creation rate uses new worlds with at least seven elapsed
  days of coverage and counts their first creation within 168 hours of world
  creation. History outside known coverage is marked as insufficient.
- MCP diagnostics reflect retained call records. Resident Life simulation
  events are displayed separately from member activity. All analysis describes
  worlds still present in the database.

## Follow-ups

An administrator can open one follow-up per world, assign an administrator,
set an optional next date, add notes and close it with a result. The world
list can show the current administrator's open follow-ups. Assignment changes
and outcomes remain in the world's follow-up history. The server applies the
shared platform-admin gate and checks the version on every update. Creation,
updates and their history are written transactionally.

## Verification

Run `make sqlc` after SQL edits and `make world-ops-test-db` for PostgreSQL
verification in a disposable schema. For browser verification, use a separate
managed development environment with both `world-ops-e2e@example.invalid` and
`world-ops-second@example.invalid` in `AURO_ADMIN_EMAILS`. Run
`WORLD_OPS_E2E=1 pnpm exec playwright test e2e/admin-world-operations.spec.ts`
from that checkout. The scenario signs in as a fixture admin and creates and
deletes fixture worlds.

### Native Desktop

Build the Desktop entry with the isolated environment's endpoints before the
native scenario. The renderer is loaded from the built file URL.

```sh
bash scripts/dev-env.sh exec -- bash -c 'VITE_API_URL="$NEXT_PUBLIC_API_URL" VITE_WS_URL="$NEXT_PUBLIC_WS_URL" VITE_APP_URL="$FRONTEND_ORIGIN" pnpm --filter @auro/desktop build'
WORLD_OPS_DESKTOP_E2E=1 pnpm exec playwright test e2e/admin-world-operations.desktop.spec.ts
```

The scenario uses an isolated application home and a test-created fake CLI.
It verifies native visit attribution, Admin module navigation, world detail
drill-down, follow-up persistence, restored list filters and return to the active
world. Default E2E runs skip it. Main-process CommonJS output uses automatic
default-import interop so the ESM `fix-path` dependency can initialize at launch.
