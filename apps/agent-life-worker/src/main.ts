import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { z } from "zod";
import { LifeStore } from "./store.ts";

const config = z.object({ DATABASE_URL: z.string().min(1), AGENT_LIFE_WORKSPACE_ID: z.string().uuid() }).parse(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, application_name: "weavea-agent-life" });
pool.on("error", (error) => console.error(JSON.stringify({ event: "life_connection_error", code: error.name })));
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown.abort());
try {
  const store = new LifeStore(pool);
  const worldId = await store.initialize(config.AGENT_LIFE_WORKSPACE_ID);
  console.info(JSON.stringify({ event: "life_ready", worldId, workspaceId: config.AGENT_LIFE_WORKSPACE_ID }));
  let lastLog = 0;
  while (!shutdown.signal.aborted) {
    try {
      const tick = await store.tick(worldId);
      if (tick !== null && (tick === 1 || tick - lastLog >= 30)) {
        console.info(JSON.stringify({ event: "life_tick", worldId, tick })); lastLog = tick;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "life_world_missing") throw error;
      // A failed transaction does not advance the clock. Reconnect and retry on the next loop.
      console.error(JSON.stringify({ event: "life_tick_failed", code: error instanceof Error ? error.name : "unknown" }));
    }
    await setTimeout(250, undefined, { signal: shutdown.signal }).catch((error: unknown) => { if (!shutdown.signal.aborted) throw error; });
  }
} finally { await pool.end(); }
