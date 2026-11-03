# Workspace browser regressions

Run `pnpm exec playwright test --config playwright.perf.config.ts` against an explicitly started Web build. The suite checks that workspace search loads on demand, retired routes return 404 and system messages work at desktop and narrow widths.

HTTP and WebSocket boundaries are synthetic. The fixture accepts only current APIs and reports unexpected requests. Host analytics are blocked. The suite does not execute agents or require accounts or a database.
