# PostHog integration verification

Date: 2026-10-30 (Asia/Shanghai). Dedicated project: 696199, US Cloud.

## Production

- Application release: `20261029T231628Z-69d86aadfef4`.
- Application commit: `69d86aadfef4`.
- Gateway certificate-chain correction: `6fbf0d6` (configuration-only publish).
- Public collector: `https://weavea.world/api/collect`.
- API and Web are active; deployment verified HTTPS, readiness, native
  dependencies and ownership of isolated Createx resources.
- AgentPage/AuroCreator process/configuration snapshots and health checks passed.
- The project token lives in the root-owned production environment file and is
  not committed. The previous environment was backed up before changes.
- `/api/config` exposes the public collector and `environment=production`.
  Server ingestion goes directly to PostHog US Cloud.

## Verification executed

| Check | Result |
| --- | --- |
| Shared analytics and API schema tests | 330 tests passed |
| Siege and Tanks view/runtime tests | 52 tests passed |
| SiteAnalytics component/StrictMode wiring | 1 test passed |
| Isolated browser test with the real SDK and a mocked collector | Passed |
| Core, views, Web and Desktop typechecks | Passed |
| Lint for changed frontend files | Passed |
| Go analytics, metrics, Siege and Tanks tests | Passed |
| Native deployment boundary tests | Passed |
| Web standalone and Desktop builds | Passed |
| Production collector diagnostic event | HTTP 200, status Ok |
| Production SDK extension script and remote config | HTTP 200 |
| Production browser pageview and header CTA | HTTP 200, no page errors |
| PostHog Activity event list | Pageview, cta_clicked and analytics_delivery_probe visibly present |

The production browser check used the deployed SDK and collection proxy. Only
its public config response was overridden locally to label that browser as
`staging`. Observed events were `$pageview` and `cta_clicked`, both labeled
`staging`; no production signup or gameplay was synthesized. Script,
remote-config and event requests all returned 200. Diagnostic events must not
enter production reports.

## Baseline failures and limits

A broad core run passed 2350 tests and failed three existing checks:
`api/tanks.test.ts`, `diagnostics/diagnostic-context.test.ts` and
`realtime/use-realtime-sync-inbox.test.tsx`. All three failures were reproduced
in the original checkout. A broad Web run passed 335 tests and failed existing
`app/text-contrast.test.ts` assertions for `packages/views/me/me-page.tsx`.
No unrelated fixes were included.

The managed local database setup could not use its generated role. Automatic
approval rejected copying the main checkout's database credentials into the
worktree. No role or database was manually created. The browser test used an
isolated collector without a database. A full authenticated signup/onboarding/
game browser journey was not run; backend acquisition emission and gameplay
were checked at their canonical test layers.

The production browser check is one network vantage point. It does not prove
delivery on every mainland/overseas carrier. Browser policy, opt-out, network
loss and blockers can omit events.

## Control plane

The project timezone was saved and visibly confirmed as Asia/Shanghai.
Dashboard and insight configuration is in progress. All saved insights must be
validated and inspected before reporting completion. Editable SQL sources are
in this directory. Production reports use `environment=production`, exclude
`is_test=true`, and leave immature D1/D7 cohorts empty instead of showing zero.
