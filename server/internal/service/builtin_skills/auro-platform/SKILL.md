---
name: auro-platform
description: "Use for Auro platform operations involving agents, chats, autopilots, runtimes, repositories, and skill imports."
user-invocable: false
allowed-tools: Bash(auro *), Bash(git *), Bash(gh *)
---

# Operating Auro

Use the `auro` CLI for platform operations. Inspect the current resource before changing it. Names and IDs differ: resolve real UUIDs with the matching list or get command. Use `auro <command> --help` for supported flags.

Read only the reference relevant to the request:

| Reference | Operations |
| --- | --- |
| `references/agents.md` | Agent definitions, permissions, secrets, MCP configuration and skills |
| `references/autopilots.md` | Scheduled, webhook and manual automation runs |
| `references/runtimes.md` | Daemons, execution credentials and repository checkouts |
| `references/skill-import.md` | Importing a skill from a URL or local archive |

Mutations and manual triggers affect real resources and consume execution budget. Perform them only within the user's request. JSON output goes to stdout; keep warnings and confirmations on stderr. Never include credentials in documents, logs or copied configuration.
