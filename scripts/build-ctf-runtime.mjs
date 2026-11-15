import { GAME_VERSION } from "../packages/core/capture-the-flag/engine.js";
import { GAME_VERSION as VALIDATION_VERSION } from "../packages/core/capture-the-flag/validator.js";
import { build } from "esbuild";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(
  root,
  process.argv[2] ?? "server/bin/runtime/ctf/engine.mjs",
);
const temp = `${output}.${process.pid}.tmp`;
await mkdir(dirname(output), { recursive: true });
try {
  await build({
    entryPoints: [resolve(root, "server/internal/ctf/runtime/bridge.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: temp,
    logLevel: "warning",
  });
  await rename(temp, output);
} finally {
  await rm(temp, { force: true });
}
const files = {};
for (const name of [
  "README.md",
  "gameplay-guide.md",
  "strategy-authoring-guide.md",
  "strategy-schema.json",
])
  files[name] = await readFile(
    resolve(root, "packages/core/capture-the-flag/rule-kit", name),
    "utf8",
  );
for (const name of ["ZS01", "ZS02"])
  files[`examples/${name}.json`] = await readFile(
    resolve(root, `packages/core/capture-the-flag/${name}.json`),
    "utf8",
  );
files["validator.mjs"] = await readFile(
  resolve(root, "packages/core/capture-the-flag/validator.js"),
  "utf8",
);
files["validate.mjs"] =
  'import fs from "node:fs";\nimport {validateStrategy} from "./validator.mjs";\nconst errors=validateStrategy(JSON.parse(fs.readFileSync(process.argv[2],"utf8")));\nconsole.log(errors.length?errors:"OK");\nprocess.exitCode=errors.length?1:0;\n';
if (
  JSON.parse(files["strategy-schema.json"]).game_version !== GAME_VERSION ||
  GAME_VERSION !== VALIDATION_VERSION
)
  throw new Error("CTF rule-kit version drift");
files["manifest.json"] = JSON.stringify(
  {
    gameVersion: GAME_VERSION,
    formatVersion: "1.0",
    files: [...Object.keys(files), "manifest.json"],
  },
  null,
  2,
);
await writeFile(
  resolve(root, "server/internal/ctf/rule-kit.gen.json"),
  JSON.stringify(files, null, 2) + "\n",
);
