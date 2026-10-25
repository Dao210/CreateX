import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", ".next", ".next-local", ".source", ".turbo", "coverage", "test-results", "next-env.d.ts"]);

/** Hash source and build inputs; no Git metadata or modification times required. */
export function webBuildFingerprint(repoRoot, env = process.env) {
  const hash = createHash("sha256");
  const visit = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name) || entry.name.endsWith(".tsbuildinfo") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) hash.update(relative(repoRoot, child)).update("\0").update(readFileSync(child)).update("\0");
    }
  };
  for (const dir of ["apps/web", "packages/core", "packages/ui", "packages/views"]) visit(join(repoRoot, dir));
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "scripts/web-runtime.mjs", env.ENV_FILE || ".env"]) {
    const path = resolve(repoRoot, file);
    if (existsSync(path)) hash.update(file).update("\0").update(readFileSync(path)).update("\0");
  }
  const inputs = Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_") || ["REMOTE_API_URL", "DOCS_URL", "CORS_ALLOWED_ORIGINS", "STANDALONE"].includes(key)).sort();
  for (const key of inputs) hash.update(key).update("=").update(env[key] || "").update("\0");
  return hash.digest("hex");
}

async function run(args, env) {
  const child = spawn("pnpm", args, { cwd: root, stdio: "inherit", env });
  const stop = (signal) => child.kill(signal);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`Web command exited with ${signal || code}`)));
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function main() {
  const command = process.argv[2];
  if (!["check", "build", "start"].includes(command)) throw new Error("Usage: node scripts/web-runtime.mjs check|build|start");
  const output = join(root, "apps/web/.next-local");
  const stamp = join(output, "source-fingerprint");
  const env = { ...process.env, NODE_ENV: "production", AURO_WEB_DIST_DIR: ".next-local" };
  const fingerprint = webBuildFingerprint(root, env);
  const fresh = existsSync(join(output, "BUILD_ID")) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === fingerprint;
  if (command === "check") { process.exitCode = fresh ? 0 : 1; return; }
  if (command === "build") {
    if (fresh) { console.log("Web production build is current."); return; }
    rmSync(stamp, { force: true });
    await run(["--filter", "@auro/web", "build"], env);
    if (webBuildFingerprint(root, env) !== fingerprint) throw new Error("Web sources changed during the build. Run make up MODE=production again.");
    writeFileSync(stamp, `${fingerprint}\n`);
    return;
  }
  if (!fresh) throw new Error("Web production build is stale. Run make up MODE=production to rebuild it.");
  await run(["--filter", "@auro/web", "exec", "next", "start", "--port", env.FRONTEND_PORT || "3000"], env);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
