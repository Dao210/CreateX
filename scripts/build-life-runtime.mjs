import { build } from "esbuild";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, process.argv[2] ?? "server/bin/runtime/life/engine.mjs");
const temporary = `${output}.${process.pid}.tmp`;
await mkdir(dirname(output), { recursive: true });
try {
  await build({ entryPoints: [resolve(root, "server/internal/life/runtime/bridge.ts")], bundle: true, platform: "node", target: "node22", format: "esm", outfile: temporary, logLevel: "warning" });
  await rename(temporary, output);
} finally { await rm(temporary, { force: true }); }
