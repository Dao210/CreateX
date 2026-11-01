# Runtimes and repository checkouts

An agent binds to a runtime hosted by a daemon. Chat and autopilot requests create execution records; the server checks permissions, wakes the runtime, and grants a run-scoped credential when the daemon claims a run. The daemon launches the configured provider CLI and reports execution results.

```bash
auro runtime list --output json
auro agent get <agent-id> --output json
auro workspace get --output json
auro repo checkout <url> [--ref <branch-or-sha>]
auro chat history --help
```

Use the world's repository configuration for code context. Repository checkout talks to the local daemon; preserve existing changes and the user's Git identity. Run credentials are restricted to their authenticated world and agent. Do not copy tokens into prompts, logs, repository files or MCP configuration.

For an agent that does not run, inspect its runtime binding, runtime availability, invocation permissions, and execution failure reason. A provider installation or authentication error requires repairing that runtime. Do not silently select another provider.
