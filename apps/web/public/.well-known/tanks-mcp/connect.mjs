#!/usr/bin/env node
// Standalone connector distributed by the same Web build as the setup guide.
// Uses the existing browser sign-in, personal tokens and workspace MCP policy.
/* global fetch, AbortSignal, AbortController */
import process from "node:process";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

export const PROTOCOL_VERSION = "2025-11-25";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE = 1024 * 1024;

function baseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) origin without credentials, query or fragment.");
  }
  return url.href.replace(/\/$/, "");
}

export function parseOptions(argv) {
  const [action, ...rest] = argv;
  if (!["install", "login", "check", "stdio"].includes(action)) {
    throw new Error("Usage: node connect.mjs <install|login|check|stdio> --app-url <Web URL> --server-url <API URL> --workspace-id <UUID> --user-id <UUID>");
  }
  const allowed = new Set(["app-url", "server-url", "workspace-id", "user-id"]);
  const fields = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]?.slice(2);
    if (!rest[i]?.startsWith("--") || !allowed.has(name) || !rest[i + 1] || fields[name]) {
      throw new Error("Invalid or duplicate connection argument.");
    }
    fields[name] = rest[i + 1];
  }
  if (!UUID.test(fields["workspace-id"] ?? "") || !UUID.test(fields["user-id"] ?? "")) {
    throw new Error("The workspace and account must use their complete UUIDs.");
  }
  return {
    action,
    appUrl: baseUrl(fields["app-url"]),
    serverUrl: baseUrl(fields["server-url"]),
    workspaceId: fields["workspace-id"].toLowerCase(),
    userId: fields["user-id"].toLowerCase(),
  };
}

export function connectionKey(options) {
  return createHash("sha256").update(JSON.stringify([options.serverUrl, options.workspaceId, options.userId])).digest("hex").slice(0, 24);
}

function credentialsPath(options, root) {
  return join(root, connectionKey(options), "credentials.json");
}

async function request(options, token, path, body, protocol = PROTOCOL_VERSION) {
  const response = await fetch(`${options.serverUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace-ID": options.workspaceId,
      Accept: "application/json, text/event-stream",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(path === "/api/tanks/mcp" ? { "MCP-Protocol-Version": protocol } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`HTTP ${response.status}. Check the service address, sign-in, workspace membership and MCP policy.`);
    error.status = response.status;
    throw error;
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > MAX_RESPONSE) throw new Error("The MCP response exceeded its size limit.");
    chunks.push(chunk);
  }
  if (!length && response.status === 202) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("The server did not return valid JSON."); }
}

async function identity(options, token) {
  const me = await request(options, token, "/api/me");
  if (typeof me?.id !== "string" || me.id.toLowerCase() !== options.userId) {
    throw new Error("Sign in with the same account as the game page. No credential was saved.");
  }
}

export async function checkConnection(options, token) {
  await identity(options, token);
  const rpc = async (id, method, params) => {
    const result = await request(options, token, "/api/tanks/mcp", { jsonrpc: "2.0", id, method, params });
    if (result?.jsonrpc !== "2.0" || result.id !== id || result.error || !result.result) {
      throw new Error("The tank MCP verification failed. Check the workspace and MCP policy.");
    }
    return result.result;
  };
  const initialized = await rpc(1, "initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "createx-tanks-setup", version: "1.0.0" } });
  if (initialized.serverInfo?.name !== "auro-tanks") throw new Error("This address is not the tank MCP service.");
  await request(options, token, "/api/tanks/mcp", { jsonrpc: "2.0", method: "notifications/initialized" });
  const catalog = await rpc(2, "tools/call", { name: "tank_get_catalog", arguments: {} });
  if (catalog.isError || catalog.structuredContent?.profile !== "tank-defense@1") {
    throw new Error("The tank catalog could not be read. Check the MCP policy before registering the connection.");
  }
  return { tool: "tank_get_catalog", profile: "tank-defense@1" };
}

export async function loadCredential(options, root) {
  let credential;
  try { credential = JSON.parse(await readFile(credentialsPath(options, root), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("The local connection credential is unreadable. Run login to replace it.");
  }
  if (credential.serverUrl !== options.serverUrl || credential.workspaceId !== options.workspaceId || credential.userId !== options.userId || typeof credential.token !== "string" || !credential.token) {
    throw new Error("The local credential does not match this connection. Run login again.");
  }
  return credential.token;
}

async function saveCredential(options, token, root) {
  const target = credentialsPath(options, root);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify({ serverUrl: options.serverUrl, workspaceId: options.workspaceId, userId: options.userId, token }), { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  await chmod(target, 0o600);
}

function openBrowser(url) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  execFile(command, args, error => { if (error) process.stderr.write("Open the sign-in link above in your browser.\n"); });
}

async function gameUrlFor(options, token) {
  try {
    const timeout = AbortSignal.timeout(5000);
    const workspace = await request({ ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout }, token, `/api/workspaces/${options.workspaceId}`);
    if (typeof workspace?.id !== "string" || workspace.id.toLowerCase() !== options.workspaceId || typeof workspace.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspace.slug)) {
      throw new Error("Invalid workspace destination.");
    }
    const url = new URL(`/${encodeURIComponent(workspace.slug)}/tanks`, options.appUrl);
    url.searchParams.set("from", "tank-connect");
    return url.href;
  } catch {
    // Returning to the browser must not undo a completed account authorization.
    process.stderr.write("Account authorization is complete, but the game page could not be resolved. Continue setup with your Agent.\n");
    return undefined;
  }
}

export async function login(options, root, { browser = openBrowser, timeout = 300_000 } = {}) {
  const cancellation = new AbortController();
  const connection = { ...options, signal: cancellation.signal };
  const state = randomBytes(32).toString("hex");
  let finish;
  let fail;
  let receiving = false;
  const completion = new Promise((resolveLogin, rejectLogin) => { finish = resolveLogin; fail = rejectLogin; });
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") { res.writeHead(404).end(); return; }
    if (url.searchParams.get("state") !== state || !url.searchParams.get("token")) {
      res.writeHead(400).end("Invalid login callback."); return;
    }
    if (receiving) { res.writeHead(409).end(); return; }
    receiving = true;
    try {
      const session = url.searchParams.get("token");
      await checkConnection(connection, session);
      const pat = await request(connection, session, "/api/tokens", { name: `Tank MCP (${hostname()})`, expires_in_days: 90 });
      if (typeof pat?.token !== "string" || !pat.token) throw new Error("The service did not issue a connection credential.");
      await checkConnection(connection, pat.token);
      cancellation.signal.throwIfAborted();
      await saveCredential(options, pat.token, root);
      clearTimeout(timer);
      const gameUrl = await gameUrlFor(connection, pat.token);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      if (gameUrl) {
        res.writeHead(303, { Location: gameUrl });
        res.end("Account authorization is complete. Returning to your game. Your Agent will finish the MCP setup.");
      } else {
        res.end("Account authorization is complete, but the game page could not be resolved. Return to your Agent to finish setup.");
      }
      finish({ token: pat.token, gameUrl });
    } catch (error) {
      res.writeHead(400).end("Sign-in did not complete. Return to your Agent for the next step.");
      fail(error);
    }
  });
  let timer;
  try {
    await new Promise((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
    const url = new URL(`${options.appUrl}/login`);
    url.searchParams.set("cli_callback", `http://127.0.0.1:${server.address().port}/callback`);
    url.searchParams.set("cli_state", state);
    process.stderr.write(`Sign in with the same account as the game page:\n${url.href}\n`);
    timer = setTimeout(() => { cancellation.abort(); fail(new Error("Sign-in timed out. Run the same install or login command again.")); }, timeout);
    Promise.resolve().then(() => browser(url.href)).catch(fail);
    return await completion;
  } finally {
    clearTimeout(timer);
    cancellation.abort();
    const forceClose = setTimeout(() => server.closeAllConnections(), 100);
    await new Promise(done => server.close(done));
    clearTimeout(forceClose);
  }
}

export function registration(options, connectorPath) {
  const args = [connectorPath, "stdio", "--app-url", options.appUrl, "--server-url", options.serverUrl, "--workspace-id", options.workspaceId, "--user-id", options.userId];
  const name = `createx_tanks_${connectionKey(options)}`;
  return {
    name,
    command: process.execPath,
    args,
    codex: ["mcp", "add", name, "--", process.execPath, ...args],
    mcpServers: { [name]: { command: process.execPath, args } },
  };
}

export async function install(options, root, loginOptions) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const source = await readFile(fileURLToPath(import.meta.url));
  const hash = createHash("sha256").update(source).digest("hex");
  const target = join(root, `connect-${hash}.mjs`);
  await writeFile(target, source, { mode: 0o700 });
  let token = await loadCredential(options, root);
  let gameUrl;
  if (token) {
    try { await checkConnection(options, token); }
    catch (error) { if (error.status !== 401) throw error; token = null; }
  }
  if (!token) ({ token, gameUrl } = await login(options, root, loginOptions));
  else gameUrl = await gameUrlFor(options, token);
  return { state: "ready-to-register", verification: { tool: "tank_get_catalog", profile: "tank-defense@1" }, ...(gameUrl ? { gameUrl } : {}), ...registration(options, target) };
}

export async function serve(options, token, input = process.stdin, output = process.stdout) {
  let protocol = PROTOCOL_VERSION;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let message;
    try {
      if (Buffer.byteLength(line) > 64 * 1024) throw new Error("oversized");
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC frame." } })}\n`);
      continue;
    }
    try {
      const response = await request(options, token, "/api/tanks/mcp", message, protocol);
      if (message?.method === "initialize" && typeof response?.result?.protocolVersion === "string") protocol = response.result.protocolVersion;
      if (message && Object.hasOwn(message, "id") && response) output.write(`${JSON.stringify(response)}\n`);
    } catch {
      if (message && Object.hasOwn(message, "id")) {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Tank MCP is unavailable. Run the connector check or login command again." } })}\n`);
      }
    }
  }
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("This connector requires Node.js 22 or newer.");
  const options = parseOptions(process.argv.slice(2));
  const root = join(homedir(), ".createx", "tanks-mcp");
  if (options.action === "install") { process.stdout.write(`${JSON.stringify(await install(options, root), null, 2)}\n`); return; }
  if (options.action === "login") { await login(options, root); process.stdout.write("Sign-in and catalog verification succeeded.\n"); return; }
  const token = await loadCredential(options, root);
  if (!token) throw new Error("Run the connector install command to sign in first.");
  if (options.action === "check") { process.stdout.write(`${JSON.stringify(await checkConnection(options, token))}\n`); return; }
  await serve(options, token);
}

// Temporary directories can use filesystem aliases, including /var on macOS.
const entryPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(() => undefined) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
