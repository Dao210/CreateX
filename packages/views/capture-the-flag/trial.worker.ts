import {
  simulate,
  TrialRequestSchema,
  type Frame,
} from "@auro/core/capture-the-flag/compute";
self.onmessage = (event: MessageEvent<unknown>) => {
  const request = TrialRequestSchema.safeParse(event.data);
  if (!request.success) {
    self.postMessage({ kind: "error" });
    return;
  }
  try {
    const { challenger, opponents, seed } = request.data;
    for (const [index, opponent] of opponents.entries()) {
      const frames: Frame[] = [];
      const outcome = simulate(
        seed,
        {
          red: challenger,
          blue: opponent.strategy,
        },
        (frame) => frames.push(frame),
      );
      self.postMessage({
        kind: "result",
        name: opponent.name,
        index,
        total: opponents.length,
        result: outcome.result,
        duration: outcome.duration,
        seed,
        frames,
      });
    }
    self.postMessage({ kind: "done" });
  } catch {
    self.postMessage({ kind: "error" });
  }
};
