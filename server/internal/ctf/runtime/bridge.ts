import { createInterface } from "node:readline";
import { StrategySchema } from "../../../../packages/core/capture-the-flag/schema";
import { simulate } from "../../../../packages/core/capture-the-flag/simulation";
import { validateStrategy } from "../../../../packages/core/capture-the-flag/validator.js";
import { calculateLeaderboard } from "../../../../packages/core/capture-the-flag/rating.js";
import type { Frame } from "../../../../packages/core/capture-the-flag/types";

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of reader) {
  try {
    if (line.length > 4 * 1024 * 1024) throw new Error("frame_too_large");
    const input = JSON.parse(line);
    if (input.version !== 1) throw new Error("protocol_version");
    let result: unknown;
    if (input.operation === "health") result = { ready: true };
    else if (input.operation === "validate")
      result = { errors: validateStrategy(input.strategy) };
    else if (input.operation === "run") {
      const red = StrategySchema.parse(input.red),
        blue = StrategySchema.parse(input.blue);
      if (
        !Number.isInteger(input.seed) ||
        input.seed < 0 ||
        input.seed > 0xffffffff
      )
        throw new Error("invalid_seed");
      const frames: Frame[] = [];
      const outcome = simulate(input.seed, { red, blue }, (frame) => {
        frames.push(frame);
        if (input.progress && frame.tick % 64 === 0)
          process.stdout.write(
            JSON.stringify({
              version: 1,
              requestId: input.requestId,
              progress: frame,
            }) + "\n",
          );
      });
      result = { ...outcome, frames };
    } else if (input.operation === "rate")
      result = calculateLeaderboard(input.records, input.matches);
    else throw new Error("unknown_operation");
    process.stdout.write(
      JSON.stringify({ version: 1, requestId: input.requestId, result }) + "\n",
    );
  } catch {
    process.stdout.write(
      JSON.stringify({ version: 1, error: "invalid_compute_request" }) + "\n",
    );
  }
}
