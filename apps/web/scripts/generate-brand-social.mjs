import { ImageResponse } from "next/og.js";
import { createElement as h } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";

// Code-native artwork; regenerate with `node apps/web/scripts/generate-brand-social.mjs`.
const threads = Array.from({ length: 9 }, (_, i) => h("path", {
  key: i, d: `M ${730 + i * 18} 80 C ${500 + i * 24} 250, ${1080 - i * 20} 350, ${850 + i * 18} 550`,
  fill: "none", stroke: i % 2 ? "#E8E1D5" : "#C8622D", strokeWidth: 3, opacity: 0.5,
}));
const image = new ImageResponse(h("div", {
  style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0A0B0E", color: "#E8E1D5", padding: "64px 72px", position: "relative" },
},
  h("svg", { width: 1200, height: 630, viewBox: "0 0 1200 630", style: { position: "absolute", top: 0, left: 0 } }, ...threads),
  h("div", { style: { display: "flex", fontSize: 24, letterSpacing: 5, color: "#D48359" } }, "WEAVEA.WORLD"),
  h("div", { style: { display: "flex", flexDirection: "column" } },
    h("div", { style: { display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -5, maxWidth: 750, lineHeight: 1.05 } }, "Weave a World"),
    h("div", { style: { display: "flex", fontSize: 34, marginTop: 28, color: "#DED4C2" } }, "Create a Life. Weave a World."),
  ),
  h("div", { style: { display: "flex", fontSize: 22, color: "#B7AEA1" } }, "Creative adventure · Virtual civilization simulation"),
), { width: 1200, height: 630 });
const output = new URL("../public/images/weave-a-world-social.png", import.meta.url);
await mkdir(new URL(".", output), { recursive: true });
await writeFile(output, Buffer.from(await image.arrayBuffer()));
process.stdout.write(`${output.pathname}\n`);
