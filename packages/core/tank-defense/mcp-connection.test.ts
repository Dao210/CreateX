// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildTankMCPContext, buildTankMCPManualConfig } from "./mcp-connection";

const input = {
  appUrl: "https://play.example.test/acme/tanks",
  serverUrl: "https://api.example.test/",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceSlug: "acme",
  workspaceName: "Acme",
  userId: "22222222-2222-4222-8222-222222222222",
};

describe("tank MCP connection instructions", () => {
  it("distributes the guide and connector from the Web origin while keeping API and account identity", () => {
    const info = buildTankMCPContext(input);
    expect(info.setup_url).toBe("https://play.example.test/.well-known/tanks-mcp/setup.md");
    expect(info.connector_url).toBe("https://play.example.test/.well-known/tanks-mcp/connect.mjs");
    expect(info.server_url).toBe("https://api.example.test");
    expect(info.workspace_id).toBe(input.workspaceId);
    expect(info.user_id).toBe(input.userId);
    expect(buildTankMCPContext({ ...input, serverUrl: "" }).server_url).toBe("https://play.example.test");
    expect(info).not.toHaveProperty("token");
  });

  it.each(["https://secret@api.example.test", "https://api.example.test?token=secret", "https://api.example.test#secret"])("rejects credential-bearing server URLs: %s", serverUrl => {
    expect(() => buildTankMCPContext({ ...input, serverUrl })).toThrow();
  });

  it("keeps manual configuration usable without putting credentials in it", () => {
    const context = buildTankMCPContext(input);
    const command = "/Users/Someone's Mac/auro";
    const manual = buildTankMCPManualConfig(context, command, "json");
    expect(JSON.parse(manual.config).mcpServers.auro_tanks).toEqual({
      type: "stdio",
      command,
      args: ["--server-url", context.server_url, "--workspace-id", context.workspace_id, "--profile", "tanks-11111111", "tanks", "mcp"],
    });
    expect(manual.login).toContain("AURO_APP_URL='https://play.example.test'");
    expect(manual.login).toContain("'/Users/Someone'\\''s Mac/auro'");
    expect(buildTankMCPManualConfig(context, command, "codex").config).toContain("[mcp_servers.auro_tanks]");
  });
});
