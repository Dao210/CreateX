# Deploy Sentinel

An incident-response plugin exposing hooks for deploy correlation and rollback,
a metrics MCP server, and a response skill. The agent uses those tools from chat.

Configure the service prefix, environment, rollback window and service
credentials in the installation. The host stores secrets as write-only values.
The manifest declares the HTTP hosts and workspace storage scope it needs.

Start the example hook endpoint with `node server/handler.mjs` and the metrics
MCP endpoint with `node server/metrics-mcp.mjs`. Set the signing secret shown
when rotating the installation token through `AURO_SIGNING_SECRET`; inspect
both entry points for their service configuration. Replace example HTTPS hosts
in the manifest with your own endpoints and matching `net:` scopes.

The hook validates the host signature and returns structured results. Rollback
requires an explicit request and must satisfy the configured environment and
time window. The skill explains how to report observations and recovery in chat.
