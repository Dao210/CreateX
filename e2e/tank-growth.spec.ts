import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { TestApiClient } from "./fixtures";

test.use({ viewport: { width: 1440, height: 980 } });

test("permanent character experience reaches me and the next frozen deployment", async ({ page, request, baseURL }) => {
  const api = new TestApiClient();
  let workspace: Awaited<ReturnType<TestApiClient["createWorkspace"]>> | undefined;
  try {
    await api.login(`tank-growth-${randomUUID()}@auro.ai`, "Tank Growth QA");
    workspace = await api.createWorkspace("Tank Growth QA", `growth-${randomUUID().slice(0, 8)}`);
    await api.markUserOnboarded();
    const token = api.getToken()!;
    const headers = { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace.id };
    const draft = { profile: "tank-defense@1", name: "天穹·蓝霆", parts: { chassis: "light", armor: "standard", cannon: "rapid" }, appearance: { body: "#38BDF8", accent: "#1D4ED8", pattern: "stripe" } };
    const saved = await request.post("/api/tanks/v1/characters", { headers, data: { requestId: randomUUID(), draft } });
    expect(saved.ok()).toBe(true);
    const character = await saved.json();
    const deployed = await request.post("/api/tanks/v1/sessions", { headers, data: { requestId: randomUUID(), characterId: character.id, revision: character.revision, contentHash: character.contentHash, mapId: "frontline" } });
    expect(deployed.ok()).toBe(true);
    const frozen = await deployed.json();
    expect(frozen.progression.xp).toBe(0);
    const runId = randomUUID();
    const started = await request.post(`/api/tanks/v1/sessions/${frozen.id}/runs`, { headers, data: { requestId: runId, levelId: 1 } });
    expect(started.ok()).toBe(true);
    // Personal training accepts bounded client summaries. Allow actual elapsed
    // time; authoritative combat replay is deliberately outside this contract.
    await new Promise(resolve => setTimeout(resolve, 5200));
    const summary = { ticks: 300, kills: 10, outcome: "defeat" };
    const endpoint = `/api/tanks/v1/sessions/${frozen.id}/runs/${runId}/settle`;
    const settled = await request.post(endpoint, { headers, data: summary });
    expect(settled.ok()).toBe(true);
    const result = await settled.json();
    expect(result).toMatchObject({ awardedXp: 100, progression: { xp: 100 } });
    expect(await (await request.post(endpoint, { headers, data: summary })).json()).toEqual(result);
    expect((await (await request.get(`/api/tanks/v1/sessions/${frozen.id}`, { headers })).json()).loadout.speed).toBe(98);

    await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
    await page.addInitScript(value => localStorage.setItem("auro_token", value), token);
    await page.goto(`/${workspace.slug}/me`);
    const card = page.getByRole("group", { name: draft.name });
    await expect(card.getByText("Lv.2", { exact: true })).toBeVisible({ timeout: 45000 });
    await expect(card).toContainText("速度 100");
    await page.screenshot({ path: "test-results/tank-growth/me-grown-tank.png", fullPage: true });
    await card.getByRole("button", { name: "进入游戏", exact: true }).click();
    const battlefield = page.getByTestId("tank-battlefield");
    await expect(battlefield).toHaveAttribute("data-player-speed", "100", { timeout: 45000 });
    const registrations: string[] = [];
    const settlements: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && /\/runs$/.test(req.url())) registrations.push(req.url());
      if (req.method() === "POST" && /\/runs\/.+\/settle$/.test(req.url())) settlements.push(req.url());
    });
    await page.getByRole("button", { name: "开始守卫", exact: true }).click();
    await expect(battlefield).toHaveAttribute("data-phase", "running");
    await page.keyboard.press("p");
    await page.getByRole("button", { name: "结束本局", exact: true }).click();
    await expect(battlefield).toHaveAttribute("data-phase", "ready");
    expect(registrations).toHaveLength(1);
    expect(settlements).toHaveLength(1);
    await page.screenshot({ path: "test-results/tank-growth/garage-grown-tank.png", fullPage: true });
  } finally {
    if (workspace) await api.deleteWorkspace();
    await api.cleanup();
  }
});
