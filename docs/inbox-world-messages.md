# Creation and world messages

Inbox is a member's entry into their creations and the whole current world's
important changes. It has All, My creations, World digests and System filters.
Web/Desktop persist the filter and selection in the URL; Mobile owns the same
categories and opens game destinations on the Web because it has no native games.

## Sources and visibility

| Fact | Personal message | World digest |
| --- | --- | --- |
| Saved Tank character, manual or MCP | MCP saves/revisions notify the owner | All members see the saved creation/revision |
| Tank experience crosses a level | Owner receives a growth milestone | All members see the milestone |
| Resident reaches its existing wood/coin goal | No personal ownership is implied | Members of the simulation's bound world see the goal |
| Automation failure protection or quota rejection | Existing responsible-human routing | Excluded |

Saved Tanks are already world-readable through their game API. Unsaved drafts,
private chats, Siege's owner-only library and other users' private progress do
not become public. Tank milestones retain their meaning as client-reported
personal play, not verified competition. Resident goals come from authoritative
simulation resource settlement. Ordinary resident actions do not create inbox
messages. No LLM or product-agent execution is added.

REACH remains an independent experimental world with separate ownership. It is
not included until a supported account/world association exists. This does not
claim that creations can travel between games.

## Delivery and hourly summaries

Source mutations append `world_inbox_event` inside their existing transaction.
Stable identities prevent duplicate Tank facts and resident-goal replay. The API
process runs a five-second projector; a PostgreSQL advisory lock coordinates
multiple processes. A failed batch rolls back both inbox rows and delivery
markers, and retries on the next pass. Multiple pending MCP revisions or growth
milestones for one character in the same batch produce one personal message for
the latest fact.

Each closed UTC hour with eligible facts produces one immutable digest per
current world member who joined before the window ended. Windows are displayed
in the user's UI locale/time zone. Repeated revisions of the same character are
combined into the latest update; totals count distinct subject/kind pairs. The
detail retains up to twelve representative changes and the full aggregate
counts. There is no empty scheduled message and no historical backfill for new
members. An API outage delays delivery; pending windows are processed on restart.

Business writers take the shared world-event advisory lock before timestamping
facts; summary generation takes its exclusive form before reading a closed hour.
An in-flight transaction at the hour boundary cannot silently land behind an
already published digest. Workspace locks precede event locks, matching deletion
order. Workspace teardown explicitly deletes the outbox. Departed members do not
receive delayed messages.

Inbox rows are the durable record. WebSocket pushes happen after commit and go
only to each recipient. A disconnect or a crash between commit and push is
recovered through normal list/reconnect refresh, rather than claiming durable
WebSocket delivery. The outbox and message history currently have no automatic
retention deletion.

Read and archive remain independent. Opening an archived item can mark it read;
restoring it preserves its current read state. A retry never reopens an existing
message or rewrites an old digest. Creation updates and world digests are independently enabled by default in each
world’s notification settings. Muting one skips future delivery of that category;
existing messages and the other category are preserved. OS banners are a separate
setting. Paused automation notices link to their automation, or to the automation
list when optional detail data is unavailable. World digests refresh unread counts quietly
and do not create OS banners. Personal/system banners follow existing background,
browser permission and source-world mute rules.

## Destinations and compatibility

Message content contains validated UUIDs and factual fields, never executable
markup or arbitrary destination URLs. Web/Desktop construct internal links with
the host navigation adapter and effective world game policy. Hidden games remain
linkable; closed games keep the historical facts but have no game action.
Mobile opens the corresponding authenticated Web destination, whose game access
boundary remains authoritative. New delivery checks the canonical effective game
policy: hidden games still contribute; closed games do not send new messages or
backfill the suppressed facts on reopening. Closing a game does not remove
already-published historical messages or stop the simulation service.

The existing `/api/inbox` and archive/write routes retain their JSON shape with
an additive optional `content` field. Both clients validate its bounded schema;
malformed content falls back to the stored title/body. Malformed optional details
fall back to null without discarding other messages. The retired issue fields
remain explicit null values at the response boundary, and retired status/priority
archive filters return no matches rather than silently expanding the result. Retired task messages stay
excluded from listing, unread counts and mutations. The `item` selection query
parameter identifies the inbox row independently of any retired task routes.

## Verification

Latest acceptance record: [2026-11-02](evidence/inbox-world-2026-11-02.md), including
isolated production-browser coverage and the remaining host-check limitations.

- `make inbox-test-db`: disposable-schema source/settlement, concurrent delivery,
  rollback/retry, membership and world isolation, immutable read/archive state.
- `make life-test-db`: authoritative goal event/outbox atomicity and restart.
- Core inbox/schema/realtime and Agent Life engine tests; views inbox and locale
  tests; mobile parser, mutation and display tests.
- `pnpm exec playwright test e2e/inbox-world.spec.ts`: actual authenticated MCP
  save, live message, read/archive/restore, a digest including another member,
  source-world links, narrow-screen navigation and cross-world isolation. It
  backdates only its fixture world's events to close a window without waiting an
  hour, and deletes its fixture worlds with TestApiClient.
