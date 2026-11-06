# Agent Life: a town with shared history

## Approved scope

Upgrade the existing `/{slug}/life` feature inside the main application. Preserve
the singleton binding, resident identities, inventories, goals and committed Tick.
Users observe, speak with residents, suggest a scheduled activity and create a
resident. Existing game access and world membership apply to all reads and writes.

## Acceptance

- A town map shows homes, workplace, forest, square, cafe, library and shop;
  residents move between meaningful places and follow daily agendas.
- Profiles, individual memories, relationships, plans, conversations and group
  activities survive API/compute restarts and are committed with simulation state.
- A reading-group invitation starts with its organizer. Only actual conversations
  spread it. Attendance follows knowledge, interests and needs; an uninformed
  resident cannot attend merely because the activity exists in world storage.
- Model planning uses the existing server LLM layer outside Tick transactions.
  Bounded jobs, leases, real-day budgets, semantic validation and explicit error
  states prevent runaway calls, stale writes and fabricated world effects.
- Model mode is explicitly configured; rules mode remains visibly identified.
  An unconfigured or failed model never masquerades as a successful response.
- User commands have durable account/world-scoped retry receipts. Commands and
  model results use the same workspace/world lock order and revision fence as Tick.
- Shared Web/Desktop UI supports observation, resident details, agenda, memories,
  relations, conversation, activity proposal and resident creation; all five
  locales, keyboard access, narrow screens and reduced motion are covered.

## Boundaries

No separate application, daemon, agent CLI or deployment unit. No extra towns,
cross-world simulation, combat, reproduction, permanent death or complex economy.
Simulation NPCs never execute product-agent tasks. Model input contains only a
resident's authorized local observations and bounded memories, with no credentials,
private product conversations or data from other worlds. Member-visible dialogue
and model prerequisites are stated beside the relevant controls.

## Verification

Core causal tests cover invitation propagation, attendance, memory retrieval,
survival and planner validation. Disposable PostgreSQL tests cover concurrent
commands, retry conflicts, rollback, stale computations, worker claims and deletion.
Model tests use a fixture endpoint. Browser checks cover the actual shared page,
mutation results and restart persistence in an isolated managed environment.
Real provider calls and production deployment are separate acceptance boundaries.
