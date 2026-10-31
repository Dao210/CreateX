# Tank permanent growth

## Problem and resulting behavior

A saved tank currently keeps its nine-point design forever while only the player's high score and unlocked maps persist. Give each owned tank its own permanent experience and level. Playing, losing or explicitly ending a round awards that tank's earned experience. Renaming, recoloring and changing parts preserve its growth. `/me` and the garage show its level, experience toward the next level, evolved appearance and current deployment stats.

## Review and architectural decisions

- Keep the initial nine-point parts budget. Arbitrary stat allocation would require balancing unrelated units (speed, integer durability, firing ticks) and would weaken the existing deterministic MCP contract.
- Use ten automatic levels. Manual specialization would introduce another mutable allocation model and revision/conflict workflow; this iteration uses visible evolution at levels five and ten.
- Store only bounded cumulative experience on the current character row. Level, bonuses and evolution are derived from the versioned canonical catalog, shared by TypeScript and Go. Design revisions and their content hashes remain immutable and do not duplicate growth.
- A deployment freezes experience and the grown loadout. No active round changes under the player. Redeploy after leveling to apply new stats.
- Register one run before starting, settle one compact summary when it ends. No input streaming, telemetry loop, physics persistence, per-kill HTTP requests or additional background service.
- Serialize training by world/member rather than the existing world-wide MCP write lock. A unique partial index allows one active training round per member. Starting another supersedes the previous unsettled round.
- Award experience and save the settlement receipt in one transaction. Same-run retries return the original result; changed bodies conflict. Collection reads include experience in their existing query, including SQL-side `mine` filtering. Successful settlement invalidates both garage and personal-library Query caches.

## Functional requirements

1. Each saved tank starts at level one with zero experience; only its owner earns training experience for it.
2. Award 10 XP per reported kill and 40 XP for completing a round, capped at 300 XP per round and 2,700 lifetime XP. Defeat and explicit end keep kill XP. Star pickups remain separate temporary firepower.
3. Levels use the catalog's exact thresholds. Maximum bonuses are +12 movement speed, +1 base armor and -3 firing ticks. Level-five and level-ten evolution preserve the original colors and markings.
4. Validate membership inside the write transaction, session/account/character ownership, stage, outcome, finite integer bounds and elapsed-time plausibility. Do not accept client-specified experience or combat attributes.
5. Display failed registration without starting the round. Preserve registration identity for retry. On failed settlement, preserve the summary and identity, display retry, and do not advance/restart before settlement succeeds.
6. Keep older character/session responses readable with absent optional growth fields. Old frozen sessions retain their original configuration; deploy again to participate in training.
7. Keep classic preset play and borrowing another member's tank usable without granting character experience.
8. Shared views and core hooks serve Web and Desktop. Translate new controls into all five shared locales.

## Acceptance criteria

- Core tests cover exact thresholds, caps, effective stats, design immutability and applying growth after changing parts.
- API boundary tests reject malformed growth, mismatched run identities and tampered deployment stats.
- PostgreSQL tests prove concurrent settlement grants once, changing a settled request conflicts, another tank stays unchanged, revised designs retain XP, frozen sessions stay unchanged, new deployments use growth, awards stop at the cap, and other members/worlds cannot claim rewards.
- Shared component tests cover registration before play, retry with the same identity, settlement, cache refresh, effective stats in `/me`, and evolved rendering.
- Run focused tests, Web/Desktop checks/builds and authenticated Tank/MCP browser regressions. Visually inspect the growth display in the browser.

## Trust and limits

Combat is client-side. These are client-reported personal training records, not server-replayed or ranked results. Server validation bounds rewards and prevents duplicate/parallel awards; it cannot prove reported kills. Competitive integrity would require authoritative battle replay or server simulation and is outside this feature. Closing/reloading the page before settlement can lose the unfinished round; use End run or finish the round before leaving. Settlement failures remain retryable while the page and 24-hour deployment are available. Run receipts expire after seven days and cannot be recreated against their expired deployment.
