// Tests the publicly downloadable Node program without any real account or Agent CLI.
/* global fetch */
import process from "node:process";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { URL } from "node:url";
import { checkConnection, connectionKey, install, loadCredential, login, parseOptions, registration, serve } from "../public/.well-known/tanks-mcp/connect.mjs";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function directory() {
  const root = await mkdtemp(join(tmpdir(), "createx-tanks-mcp-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function mockApi(settings = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: req.url, headers: req.headers, body });
    const send = value => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (settings.status || req.headers.authorization === "Bearer expired-fixture") { res.writeHead(settings.status ?? 401).end(); return; }
    if (settings.redirect) { res.writeHead(302, { Location: settings.redirect }).end(); return; }
    if (req.url === "/api/me") { send({ id: settings.userId ?? userId }); return; }
    if (req.url === "/api/tokens") { send({ token: "fixture-personal-token" }); return; }
    if (req.url === `/api/workspaces/${workspaceId}`) {
      if (settings.workspaceStatus) { res.writeHead(settings.workspaceStatus).end(); return; }
      await settings.onWorkspace?.();
      send(settings.workspace ?? { id: workspaceId, slug: "verified-world" }); return;
    }
    if (body.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    const result = body.method === "initialize"
      ? { serverInfo: { name: "auro-tanks" }, protocolVersion: body.params.protocolVersion }
      : { structuredContent: { profile: settings.profile ?? "tank-defense@1" }, isError: settings.isError ?? false };
    send({ jsonrpc: "2.0", id: body.id, result });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { calls, options: { action: "install", serverUrl: url, appUrl: url, workspaceId, userId } };
}

function browserCallback(assertWrongState = false, inspect = () => {}) {
  const completion = Promise.withResolvers();
  completion.promise.catch(() => {});
  const visit = async link => {
    const loginUrl = new URL(link);
    assert.equal(loginUrl.pathname, "/login");
    const callback = new URL(loginUrl.searchParams.get("cli_callback"));
    assert.equal(callback.hostname, "127.0.0.1");
    callback.searchParams.set("token", "fixture-session-token");
    if (assertWrongState) {
      callback.searchParams.set("state", "incorrect");
      assert.equal((await fetch(callback)).status, 400);
    }
    callback.searchParams.set("state", loginUrl.searchParams.get("cli_state"));
    const response = await fetch(callback, { redirect: "manual" });
    await inspect(response.clone(), callback);
    await response.text();
  };
  const browser = link => {
    const result = visit(link);
    result.then(completion.resolve, completion.reject);
    return result;
  };
  return Object.assign(browser, { completed: completion.promise });
}

test("validates complete connection data and separates API/workspace/account credentials", () => {
  const options = parseOptions(["install", "--app-url", "https://play.example.test", "--server-url", "https://api.example.test/", "--workspace-id", workspaceId, "--user-id", userId]);
  assert.equal(options.serverUrl, "https://api.example.test");
  assert.notEqual(connectionKey(options), connectionKey({ ...options, userId: workspaceId }));
  assert.notEqual(connectionKey(options), connectionKey({ ...options, workspaceId: userId }));
  assert.notEqual(connectionKey(options), connectionKey({ ...options, serverUrl: "https://other.example.test" }));
  const args = ["install", "--app-url", "https://play.example.test", "--server-url", "https://api.example.test", "--workspace-id", workspaceId, "--user-id", userId];
  assert.throws(() => parseOptions([...args, "--user-id", userId]), /duplicate/);
  assert.throws(() => parseOptions(args.map(value => value === workspaceId ? "acme" : value)), /complete UUID/);
  assert.throws(() => parseOptions(args.map(value => value === "https://api.example.test" ? "https://secret@api.example.test" : value)), /without credentials/);
});

test("verifies identity and the actual read-only MCP catalog with workspace credentials", async () => {
  const { options, calls } = await mockApi();
  assert.equal((await checkConnection(options, "fixture-personal-token")).profile, "tank-defense@1");
  assert.ok(calls.every(call => call.headers.authorization === "Bearer fixture-personal-token" && call.headers["x-workspace-id"] === workspaceId));
  assert.deepEqual(calls.filter(call => call.body).map(call => call.body.method), ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(calls.at(-1).body.params.name, "tank_get_catalog");
  assert.ok(!calls.some(call => ["tank_save_character", "tank_create_session"].includes(call.body?.params?.name)));
});

test("rejects the wrong account, disabled tools and incompatible catalogs", async () => {
  for (const settings of [{ userId: workspaceId }, { isError: true }, { profile: "ground2d@1" }]) {
    const { options } = await mockApi(settings);
    await assert.rejects(checkConnection(options, "fixture"));
  }
});

test("does not follow HTTP redirects carrying a credential", async () => {
  const target = await mockApi();
  const source = await mockApi({ redirect: `${target.options.serverUrl}/api/me` });
  await assert.rejects(checkConnection(source.options, "fixture"));
  assert.equal(target.calls.length, 0);
});

test("browser login requires matching state and account, then stores a verified private credential", async () => {
  const root = await directory();
  const { options, calls } = await mockApi();
  const browser = browserCallback(true, async response => {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${options.appUrl}/verified-world/tanks?from=tank-connect`);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(await loadCredential(options, root), "fixture-personal-token");
  });
  const completed = await login(options, root, { browser, timeout: 5000 });
  await browser.completed;
  assert.equal(completed.gameUrl, `${options.appUrl}/verified-world/tanks?from=tank-connect`);
  assert.equal(await loadCredential(options, root), "fixture-personal-token");
  const file = join(root, connectionKey(options), "credentials.json");
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(calls.filter(call => call.path === "/api/tokens").length, 1);
  assert.equal(calls.find(call => call.path === "/api/tokens").body.expires_in_days, 90);
});

test("wrong-account browser login issues no personal token and saves no credential", async () => {
  const root = await directory();
  const { options, calls } = await mockApi({ userId: workspaceId });
  await assert.rejects(login(options, root, { browser: browserCallback(), timeout: 5000 }), /same account/);
  assert.equal(await loadCredential(options, root), null);
  assert.ok(!calls.some(call => call.path === "/api/tokens"));
});

test("a failed catalog check during login issues no personal token", async () => {
  const root = await directory();
  const { options, calls } = await mockApi({ isError: true });
  await assert.rejects(login(options, root, { browser: browserCallback(), timeout: 5000 }), /catalog/);
  assert.ok(!calls.some(call => call.path === "/api/tokens"));
});

test("a failed private credential save never redirects to the game", async () => {
  const root = await directory();
  const blocked = join(root, "not-a-directory");
  await writeFile(blocked, "fixture");
  const { options, calls } = await mockApi();
  const browser = browserCallback(false, async response => {
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("location"), null);
    assert.match(await response.text(), /Sign-in did not complete/);
  });
  await assert.rejects(login(options, blocked, { browser, timeout: 5000 }));
  await browser.completed;
  assert.ok(!calls.some(call => call.path === `/api/workspaces/${workspaceId}`));
});

test("sign-in timeout closes the callback and leaves credentials absent", async () => {
  const root = await directory();
  const { options } = await mockApi();
  let callback;
  await assert.rejects(login(options, root, { browser: link => { callback = new URL(link).searchParams.get("cli_callback"); }, timeout: 30 }), /timed out/);
  await assert.rejects(fetch(callback));
  assert.equal(await loadCredential(options, root), null);
});

test("install is repeatable, keeps an immutable executable and never returns a token", async () => {
  const root = await directory();
  const { options, calls } = await mockApi();
  const first = await install(options, root, { browser: browserCallback(), timeout: 5000 });
  const second = await install(options, root, { browser: () => assert.fail("valid credential should be reused") });
  assert.equal(first.state, "ready-to-register");
  assert.equal(first.gameUrl, `${options.appUrl}/verified-world/tanks?from=tank-connect`);
  assert.equal(second.gameUrl, first.gameUrl);
  assert.equal(first.name, second.name);
  assert.equal(first.args[0], second.args[0]);
  assert.match(await readFile(first.args[0], "utf8"), /export async function serve/);
  assert.equal(calls.filter(call => call.path === "/api/tokens").length, 1);
  assert.ok(!JSON.stringify(first).includes("fixture-personal-token"));
  assert.ok(!JSON.stringify(first).includes("fixture-session-token"));
  assert.equal((await readdir(root)).filter(name => name.endsWith(".mjs")).length, 1);
  assert.deepEqual(first.codex.slice(0, 4), ["mcp", "add", first.name, "--"]);
  assert.equal(first.mcpServers[first.name].command, process.execPath);
});

test("returns to the bound Web origin and only forwards the verified workspace path", async () => {
  const root = await directory();
  const { options, calls } = await mockApi({ onWorkspace: () => loadCredential(options, root).then(token => assert.equal(token, "fixture-personal-token")) });
  options.appUrl = "https://play.example.test";
  const browser = browserCallback(false, response => {
    const location = response.headers.get("location");
    assert.equal(location, "https://play.example.test/verified-world/tanks?from=tank-connect");
    assert.ok(!location.includes("token"));
    assert.ok(!location.includes("state"));
    assert.ok(!location.includes("callback"));
  });
  await login(options, root, { browser, timeout: 5000 });
  await browser.completed;
  assert.ok(calls.every(call => call.headers["x-workspace-id"] === workspaceId));
  assert.ok(calls.every(call => !["tank_save_character", "tank_create_session"].includes(call.body?.params?.name)));
});

test("workspace navigation failures preserve authorization and client registration readiness", async () => {
  for (const settings of [
    { workspaceStatus: 503 },
    { workspaceStatus: 403 },
    { workspace: { id: userId, slug: "wrong-world" } },
    { workspace: { id: workspaceId, slug: "../../evil" } },
    { workspace: { id: workspaceId, slug: "//evil.test" } },
    { workspace: { id: workspaceId, slug: "world?token=fixture" } },
    { workspace: { id: workspaceId, slug: "world-" } },
    { workspace: { id: workspaceId } },
  ]) {
    const root = await directory();
    const { options, calls } = await mockApi(settings);
    const browser = browserCallback(false, async response => {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("location"), null);
      const body = await response.text();
      assert.match(body, /authorization.*complete/i);
      assert.match(body, /return to.*Agent/i);
      assert.ok(!body.includes("fixture-personal-token"));
      assert.ok(!body.includes("fixture-session-token"));
    });
    const result = await install(options, root, { browser, timeout: 5000 });
    await browser.completed;
    assert.equal(result.state, "ready-to-register");
    assert.equal(result.gameUrl, undefined);
    assert.equal(await loadCredential(options, root), "fixture-personal-token");
    const reused = await install(options, root, { browser: () => assert.fail("navigation failure must not require another login") });
    assert.equal(reused.state, "ready-to-register");
    assert.equal(calls.filter(call => call.path === "/api/tokens").length, 1);
  }
});

test("a stalled game destination cannot time out a completed account authorization", async () => {
  const root = await directory();
  const { options } = await mockApi({ onWorkspace: () => new Promise(() => {}) });
  const browser = browserCallback(false, response => { assert.equal(response.status, 200); assert.equal(response.headers.get("location"), null); });
  const result = await install(options, root, { browser, timeout: 1000 });
  await browser.completed;
  assert.equal(result.state, "ready-to-register");
  assert.equal(result.gameUrl, undefined);
  assert.equal(await loadCredential(options, root), "fixture-personal-token");
});

test("downloaded entry points execute through an aliased temporary directory without accessing credentials", async () => {
  const root = await directory();
  const source = join(root, "source");
  const alias = join(root, "alias");
  await mkdir(source);
  await writeFile(join(source, "connect.mjs"), await readFile(new URL("../public/.well-known/tanks-mcp/connect.mjs", import.meta.url)));
  await symlink(source, alias, process.platform === "win32" ? "junction" : "dir");
  const result = spawnSync(process.execPath, [join(alias, "connect.mjs"), "invalid-action"], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node connect.mjs/);
});

test("replaying a callback while its return URL resolves cannot issue another credential", async () => {
  const root = await directory();
  const { options, calls } = await mockApi();
  const probe = Promise.withResolvers();
  probe.promise.catch(() => {});
  const visit = async link => {
    const loginUrl = new URL(link);
    const callback = new URL(loginUrl.searchParams.get("cli_callback"));
    callback.searchParams.set("state", loginUrl.searchParams.get("cli_state"));
    callback.searchParams.set("token", "fixture-session-token");
    const responses = await Promise.all([fetch(callback, { redirect: "manual" }), fetch(callback, { redirect: "manual" })]);
    for (const response of responses) await response.text();
    return responses.map(response => response.status).sort();
  };
  await login(options, root, { browser: link => {
    const result = visit(link);
    result.then(probe.resolve, probe.reject);
    return result;
  }, timeout: 5000 });
  assert.deepEqual(await probe.promise, [303, 409]);
  assert.equal(calls.filter(call => call.path === "/api/tokens").length, 1);
});

test("registration uses absolute runtime/file paths without embedding credentials", () => {
  const options = { serverUrl: "https://api.example.test", appUrl: "https://play.example.test", workspaceId, userId };
  const result = registration(options, "/path with spaces/connect.mjs");
  assert.equal(result.args[0], "/path with spaces/connect.mjs");
  assert.equal(result.args[1], "stdio");
  assert.ok(result.args.includes(workspaceId));
  assert.ok(!JSON.stringify(result).includes("Bearer"));
});

test("install replaces an expired credential through browser sign-in", async () => {
  const root = await directory();
  const { options, calls } = await mockApi();
  const folder = join(root, connectionKey(options));
  await mkdir(folder);
  await writeFile(join(folder, "credentials.json"), JSON.stringify({ ...options, token: "expired-fixture" }), { mode: 0o600 });
  await install(options, root, { browser: browserCallback(), timeout: 5000 });
  assert.equal(await loadCredential(options, root), "fixture-personal-token");
  assert.equal(calls.filter(call => call.path === "/api/tokens").length, 1);
});

test("network/service failures do not discard a credential or start another login", async () => {
  const root = await directory();
  const { options } = await mockApi({ status: 503 });
  const folder = join(root, connectionKey(options));
  await mkdir(folder);
  await writeFile(join(folder, "credentials.json"), JSON.stringify({ ...options, token: "existing-fixture" }), { mode: 0o600 });
  await assert.rejects(install(options, root, { browser: () => assert.fail("must not open a login for a service failure") }), /HTTP 503/);
  assert.equal(await loadCredential(options, root), "existing-fixture");
});

test("stdio emits only JSON-RPC responses, preserves ids and negotiated protocol, and skips notifications", async () => {
  const { options, calls } = await mockApi();
  const messages = [
    { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "tank_get_catalog", arguments: {} } },
  ];
  let output = "";
  await serve(options, "fixture-personal-token", Readable.from(messages.map(value => `${JSON.stringify(value)}\n`)), new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }));
  const frames = output.trim().split("\n").map(value => JSON.parse(value));
  assert.deepEqual(frames.map(frame => frame.id), ["init", 2]);
  assert.equal(calls.at(-1).headers["mcp-protocol-version"], "2025-03-26");
  assert.ok(!output.includes("fixture-personal-token"));
});

test("stdio reports bounded parse/service failures without exposing credentials", async () => {
  const { options } = await mockApi({ status: 401 });
  let output = "";
  await serve(options, "fixture-secret", Readable.from(["not-json\n", `${JSON.stringify({ jsonrpc: "2.0", id: "read", method: "tools/list" })}\n`]), new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }));
  const frames = output.trim().split("\n").map(value => JSON.parse(value));
  assert.equal(frames[0].error.code, -32700);
  assert.equal(frames[1].id, "read");
  assert.equal(frames[1].error.code, -32000);
  assert.ok(!output.includes("fixture-secret"));
});
