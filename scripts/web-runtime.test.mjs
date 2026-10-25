import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webBuildFingerprint } from "./web-runtime.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "auro-web-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "apps/web/page.tsx"), "before");
  return root;
}

test("source and selected environment changes invalidate the build", (t) => {
  const root = fixture(t);
  const before = webBuildFingerprint(root, {});
  writeFileSync(join(root, "apps/web/page.tsx"), "after");
  const after = webBuildFingerprint(root, {});
  assert.notEqual(before, after);
  assert.notEqual(after, webBuildFingerprint(root, { NEXT_PUBLIC_API_URL: "http://localhost:18080" }));
  writeFileSync(join(root, ".env.worktree"), "NEXT_PUBLIC_API_URL=http://localhost:18081");
  assert.notEqual(after, webBuildFingerprint(root, { ENV_FILE: ".env.worktree" }));
});

test("generated output and test artifacts do not invalidate a production build", (t) => {
  const root = fixture(t);
  const before = webBuildFingerprint(root, {});
  mkdirSync(join(root, "apps/web/.next-local"));
  mkdirSync(join(root, "apps/web/.next"));
  writeFileSync(join(root, "apps/web/.next-local/BUILD_ID"), "generated");
  writeFileSync(join(root, "apps/web/.next/trace"), "trace");
  writeFileSync(join(root, "apps/web/next-env.d.ts"), "generated");
  writeFileSync(join(root, "apps/web/page.test.tsx"), "test only");
  assert.equal(before, webBuildFingerprint(root, {}));
});

test("unrelated runtime variables do not invalidate the build", (t) => {
  const root = fixture(t);
  assert.equal(webBuildFingerprint(root, { PORT: "18080" }), webBuildFingerprint(root, { PORT: "18081" }));
});
