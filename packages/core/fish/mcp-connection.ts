export const FISH_MCP_SETUP_PATH = "/.well-known/fish-mcp/setup.md";
export const FISH_MCP_CONNECTOR_PATH = "/.well-known/fish-mcp/connect.mjs";

export function buildFishMCPContext(input: {
  appUrl: string;
  serverUrl: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName?: string;
  userId: string;
}) {
  const app = new URL(input.appUrl).origin;
  const server = new URL(input.serverUrl || app, app);
  if (server.username || server.password || server.search || server.hash) {
    throw new Error("Fish MCP requires a server URL without credentials, query or fragment");
  }
  return {
    version: 1,
    setup_url: new URL(FISH_MCP_SETUP_PATH, app).href,
    connector_url: new URL(FISH_MCP_CONNECTOR_PATH, app).href,
    server_url: server.href.replace(/\/$/, ""),
    app_url: app,
    workspace_id: input.workspaceId,
    workspace_slug: input.workspaceSlug,
    workspace_name: input.workspaceName || input.workspaceSlug,
    user_id: input.userId,
  };
}

export type FishMCPContext = ReturnType<typeof buildFishMCPContext>;

export function buildFishCreationInstructions(context: FishMCPContext, prompt: string, creation: {
  name: string;
  description: string;
  releaseToPublic: boolean;
}) {
  return `${prompt}\n\n${JSON.stringify({
    ...context,
    creation: {
      name: creation.name.trim() || null,
      description: creation.description.trim(),
      destination: creation.releaseToPublic ? "public" : "preview",
    },
  }, null, 2)}`;
}

export function buildFishMCPManualConfig(context: FishMCPContext, command: string, client: string) {
  const profile = `fish-${context.workspace_id.slice(0, 8)}`;
  const args = ["--server-url", context.server_url, "--workspace-id", context.workspace_id, "--profile", profile, "fish", "mcp"];
  const config = client === "codex"
    ? `[mcp_servers.auro_fish]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}`
    : JSON.stringify({ mcpServers: { auro_fish: { type: "stdio", command, args } } }, null, 2);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const login = `AURO_APP_URL=${quote(context.app_url)} ${quote(command)} --server-url ${quote(context.server_url)} --profile ${quote(profile)} login`;
  return { config, login, endpoint: `${context.server_url}/api/fish/mcp` };
}
