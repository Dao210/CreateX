import { readFile, writeFile } from "node:fs/promises";
const source = new URL("../packages/core/fish/catalog.json", import.meta.url);
const output = new URL("../server/internal/fish/catalog.gen.json", import.meta.url);
const text = await readFile(source, "utf8");
const catalog = JSON.parse(text);
if (catalog.profile !== "fish@1" || catalog.examples.length !== 6) throw new Error("Invalid fish catalog");
await writeFile(output, text);
const cases = await readFile(new URL("../packages/core/fish/contract-cases.json", import.meta.url), "utf8");
await writeFile(new URL("../server/internal/fish/contract-cases.gen.json", import.meta.url), cases);
