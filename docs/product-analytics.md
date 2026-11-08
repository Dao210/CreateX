# Createx product analytics

PostHog Cloud measures acquisition, first play and repeat play. Production uses
the dedicated US Cloud project 696199. The project token belongs in
`/etc/createx/backend.env`; never commit a deployment's token. Development and
unconfigured deployments send no events unless explicitly configured.

```dotenv
POSTHOG_API_KEY=<project token>
POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_PUBLIC_HOST=https://weavea.world/api/collect
ANALYTICS_ENVIRONMENT=production
ANALYTICS_DISABLED=false
```

The native Createx gateway proxies `/api/collect/` to the fixed US ingestion
upstream and `/api/collect/static/` and `/api/collect/array/` to its asset upstream. TLS is verified.
Application cookies and authorization headers are not forwarded. The browser
receives the public token and browser host through `/api/config`; Go sends
directly to `POSTHOG_HOST`. This proxy still sends data to US Cloud; it does
not change data residency or guarantee reachability on every user network.
Use an absolute public host so installed Desktop clients resolve ingestion
against the deployed gateway rather than their renderer's local origin.
The gateway refreshes upstream DNS through the host's systemd-resolved stub.
It accepts `CF-Connecting-IP` for analytics only when the connection comes from
Cloudflare's published ranges; direct connections use their peer address.
Maintain those ranges against https://www.cloudflare.com/ips/ when they change.
Server events disable GeoIP enrichment so the data center does not overwrite
browser-derived user geography.

`SiteAnalytics` lives at the Web root and dynamically loads only the analytics
module. Public marketing pages keep their independent rendering and do not
mount application providers, authentication or chat stores. Login identifies
the browser with the user UUID; backend events use the same UUID. Logout resets
the identity. Attribution is captured on the first public visit. The existing
signup-source cookie supplies first-touch attribution to server signup events.

## Event contract

| Event | Owner | Meaning |
| --- | --- | --- |
| `$pageview` | Web | Initial page or pathname change; normalized `page`, `$pathname`, `language` |
| `cta_clicked` | Web | Explicitly tagged marketing action; `cta`, `page`, `language` |
| `signup` | Go | Account successfully created |
| `onboarding_completed` | Go | Onboarding successfully completed |
| `game_opened` | Shared views | Game screen ready; `game`, `mode`, `workspace_id` |
| `battle_started` | Shared views | A new observed playable attempt; game context and `attempt_id` |
| `battle_ended` | Shared views | Observed terminal result; attempt context, `result`, `active_duration_ms` |

Battle results are client-reported personal gameplay, not verified rankings.
Pauses, hidden-tab pauses and campaign intermissions are excluded from active
time. Retrying or restoring a checkpoint creates a new observed attempt.
Unloading an unfinished attempt does not synthesize a terminal result; a
missing end can also mean delivery loss. Do not interpret unmatched starts as
confirmed defeats or confirmed exits. Collection is best-effort and must not
block gameplay or server requests. The pre-init client buffer is bounded.

Automatic clicks, automatic pageviews, pageleave, heatmaps, surveys and session
replay remain disabled. The single Web tracker owns pageviews. Signup and
onboarding completion also increment existing Prometheus counters. All other
existing server business and operational events remain metrics-only.

Names and emails are removed from frontend person properties. Signup does not
send the email address. URL properties (including initial person properties)
are reduced to an origin and normalized route; referrers retain only origin.
Never add chat text, prompts, passwords, codes, raw drafts or full URLs to
events. Config responses pass through the shared analytics zod schema.

## Dashboards and definitions

Versioned query definitions live in [analytics/](analytics/). Saving and
validating them in the PostHog project is a separate control-plane operation.

Filter all production reports to `environment = production` and exclude
`is_test = true`. Use Asia/Shanghai as the reporting timezone.

1. Acquisition: pageview visitor count by referrer/UTM/country/language;
   homepage → `cta_clicked` with `cta = hero_create_tank`, `hero_create_fish`,
   `hero_create_resident` or the corresponding `card_create_*` action → signup →
   onboarding completed → battle started, within 7 days. This is a new-user
   funnel. Returning players may bypass signup and must be viewed separately.
2. Gameplay: unique players and attempts by `game`/`mode`, results by
   `level_id`/`difficulty`, and active durations for completed attempts.
3. Retention: first-ever `battle_started` as cohort entry and another
   `battle_started` on subsequent calendar days as return. Show D1 and D7,
   split by game, country and acquisition source. Cohorts need the full
   observation window before their results are complete.

## Verification and operations

Verify an anonymous visit, tagged CTA, identity merge, onboarding, game entry,
actual play, terminal result and logout. Confirm one start/end per attempt,
pause timing, retry identity, malformed configuration and URL scrubbing.
Check the browser network response and PostHog event visibility; a successful
HTTP response alone does not prove the event is queryable. Production diagnostic
probes use `environment = staging`, `is_test = true` and a dedicated diagnostic
distinct ID. Do not generate synthetic production signup/play events.

Disable both clients with `ANALYTICS_DISABLED=true` and restart the API. A browser
already initialized keeps its SDK until it reloads. PostHog project management
(dashboards, insights and settings) requires an authenticated control-plane
session or an appropriately scoped management credential; the public project
token provides ingestion only.
