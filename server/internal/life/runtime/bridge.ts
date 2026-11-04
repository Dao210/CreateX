import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { advanceTick, seedResidents, seedResources } from "../../../../packages/core/agent-life/engine";
import { LIFE_TICK_MS } from "../../../../packages/core/agent-life/rules";
import { LIFE_PROTOCOL_VERSION, RuntimeRequestSchema, SeedSchema, TickResultSchema } from "../../../../packages/core/agent-life/runtime-contract";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
// This executable is a pure compute host. It has no database, network or agent CLI integration.
for await (const line of lines) {
  if (Buffer.byteLength(line) > 1024 * 1024) process.exit(1);
  let requestId: string | null = null;
  try {
    const request = RuntimeRequestSchema.parse(JSON.parse(line));
    requestId = request.requestId;
    const result = request.operation === "seed"
      ? SeedSchema.parse((() => { const agents = seedResidents(); return { agents, resources: seedResources(agents), tickMs: LIFE_TICK_MS }; })())
      : TickResultSchema.parse(advanceTick(request.state, randomUUID));
    process.stdout.write(`${JSON.stringify({ version: LIFE_PROTOCOL_VERSION, requestId, result })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ version: LIFE_PROTOCOL_VERSION, requestId, error: "invalid_engine_request" })}\n`);
  }
}
