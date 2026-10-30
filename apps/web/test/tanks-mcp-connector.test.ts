// @vitest-environment node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "vitest";

// Run the downloadable file in native Node, exactly as an external Agent would.
it("verifies the distributed connector against fixture-only HTTP and browser-login flows", async () => {
  await promisify(execFile)(process.execPath, ["--test", fileURLToPath(new URL("./tanks-mcp-connector.test.mjs", import.meta.url))], { timeout: 20_000 });
}, 25_000);
