import { expect, test, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TestApiClient } from "./fixtures";

test.skip(process.env.WORLD_OPS_DESKTOP_E2E !== "1", "Use an isolated managed API and a built Desktop renderer.");

test("native Admin overlay preserves world filters and closes back to the active world", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await mkdtemp(join(tmpdir(), "world-ops-electron-"));
  const desktop = resolve("apps/desktop");
  const bundle = join(fixture, "bundle");
  const fixtureHome = join(fixture, "home");
  const cliLog = join(fixture, "cli-calls.jsonl");
  const api = new TestApiClient();
  let app: ElectronApplication | undefined;
  let page: Page | undefined;
  const diagnostics: string[] = [];
  let world: Awaited<ReturnType<TestApiClient["createWorkspace"]>> | undefined;
  try {
    await api.login("world-ops-e2e@example.invalid", "Native Ops QA");
    const suffix = Date.now().toString(36);
    world = await api.createWorkspace("Native Ops " + suffix, "native-ops-" + suffix);
    await api.markUserOnboarded();
    await mkdir(join(bundle, "resources", "bin"), { recursive: true });
    await mkdir(join(fixtureHome, ".auro"), { recursive: true });
    await mkdir(join(fixture, "appData"), { recursive: true });
    await writeFile(join(bundle, "package.json"), JSON.stringify({ name: "world-ops-native-fixture", version: "0.0.0" }));
    await writeFile(join(fixtureHome, ".auro", "desktop_prefs.json"), JSON.stringify({ autoStart: false, autoStop: false }));
    // Only this fixture executable may be resolved during native UI verification.
    await writeFile(join(bundle, "resources", "bin", "auro"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(cliLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  process.stdout.write(JSON.stringify({ version: "0.0.0-native-fixture" }));
} else if (args[0] === "daemon" && args[1] === "probe-runtimes") {
  process.stdout.write(JSON.stringify({ probe_result: "success", runtime_count: 0, provider_summary: {} }));
} else {
  process.exitCode = 2;
}
`, { mode: 0o755 });
    const wrapper = join(fixture, "launch.cjs");
    await writeFile(wrapper, `
const { app } = require("electron");
const os = require("node:os");
os.homedir = () => ${JSON.stringify(fixtureHome)};
app.setPath("home", ${JSON.stringify(fixtureHome)});
app.setPath("appData", ${JSON.stringify(join(fixture, "appData"))});
app.setAppPath(${JSON.stringify(bundle)});
app.setAsDefaultProtocolClient = () => false;
require(${JSON.stringify(join(desktop, "out", "main", "index.js"))});
`);
    const requireDesktop = createRequire(join(desktop, "package.json"));
    const executablePath = requireDesktop("electron") as string;
    const env: NodeJS.ProcessEnv = { ...process.env, DESKTOP_APP_SUFFIX: "world-ops-native-" + suffix };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await electron.launch({ executablePath, args: [wrapper], env, timeout: 30_000 });
    page = await app.firstWindow();
    page.on("pageerror", error => diagnostics.push(error.message));
    page.on("response", response => {
      if (response.url().includes("/api/admin/worlds")) diagnostics.push(`${response.status()} ${response.url()}`);
    });
    await page.waitForLoadState("domcontentloaded");
    expect(page.url().startsWith("file://")).toBe(true);
    await page.evaluate(token => {
      localStorage.setItem("auro_token", token);
      localStorage.setItem("auro-locale", "en");
    }, api.getToken()!);
    const visit = page.waitForResponse(response => response.url().endsWith("/api/world-visit") && response.request().method() === "POST");
    await page.reload();
    const response = await visit;
    expect(response.status()).toBe(204);
    expect(response.request().headers()["x-workspace-id"]).toBe(world.id);
    expect(response.request().headers()["x-client-platform"]).toBe("desktop");
    await page.getByRole("link", { name: "Admin console", exact: true }).click();
    await page.getByRole("button", { name: "World operations", exact: true }).click();
    const adminRoot = page.locator(".admin-root");
    await expect(adminRoot.getByRole("heading", { name: "World operations" })).toBeVisible();
    await adminRoot.getByRole("searchbox", { name: "Find a world" }).fill(world.slug);
    await adminRoot.getByRole("button", { name: "Find a world", exact: true }).click();
    await adminRoot.getByRole("combobox", { name: "Group", exact: true }).selectOption("visited");
    await adminRoot.getByRole("link", { name: world.name, exact: true }).click();
    await expect(adminRoot.getByRole("heading", { name: world.name, exact: true })).toBeVisible();
    await adminRoot.getByRole("button", { name: "Start follow-up" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Assignee")).toBeEnabled();
    const reason = dialog.getByLabel("Reason");
    await reason.focus();
    await reason.fill("Native overlay verification");
    await expect(reason).toHaveValue("Native overlay verification");
    await expect(dialog.getByLabel("Next follow-up date")).toHaveValue("");
    const saved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/followups/"));
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const saveResponse = await saved;
    expect(saveResponse.request().postDataJSON().note).toBe("Native overlay verification");
    expect(saveResponse.status()).toBe(204);
    await expect(dialog).toBeHidden();
    await expect(adminRoot.getByText("Native overlay verification", { exact: true })).toBeVisible();
    await adminRoot.getByRole("link", { name: "Back to worlds", exact: true }).click();
    await expect(adminRoot.getByRole("searchbox", { name: "Find a world" })).toHaveValue(world.slug);
    await expect(adminRoot.getByRole("combobox", { name: "Group", exact: true })).toHaveValue("visited");
    await adminRoot.getByRole("button", { name: "MCP services", exact: true }).click();
    await expect(adminRoot.getByRole("heading", { name: "MCP services", exact: true })).toBeVisible();
    await adminRoot.getByRole("button", { name: "World operations", exact: true }).click();
    await expect(adminRoot.getByRole("heading", { name: "World operations", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("world-operations-native.png") });
    await adminRoot.getByRole("button", { name: /Back to/ }).click();
    await expect(adminRoot.getByRole("heading", { name: "World operations", exact: true })).toBeHidden();
    await expect(page.getByRole("link", { name: "Admin console", exact: true })).toBeVisible();
    const calls = (await readFile(cliLog, "utf8")).trim().split("\n").map(line => JSON.parse(line) as string[]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(args => args[0] === "version" || (args[0] === "daemon" && args[1] === "probe-runtimes"))).toBe(true);
  } catch (error) {
    if (page && !page.isClosed()) {
      await testInfo.attach("native-failure", {
        body: diagnostics.join("\n") + "\n" + await page.locator("body").innerText(),
        contentType: "text/plain",
      });
      await page.screenshot({ path: testInfo.outputPath("native-failure.png") });
    }
    throw error;
  } finally {
    if (app) await app.close();
    if (world) {
      api.setWorkspaceId(world.id);
      api.setWorkspaceSlug(world.slug);
      await api.deleteWorkspace();
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
