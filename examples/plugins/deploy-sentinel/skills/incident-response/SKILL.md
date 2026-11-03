---
name: incident-response
description: Investigate a production incident using deploy correlation and metrics, then report recovery evidence in chat.
---

# Respond to an incident

Establish the affected service, environment, symptoms and start time. Read the
current metrics and correlate recent deploys before proposing a change.
Distinguish measured facts from hypotheses and keep a concise timeline in chat.

Use the plugin's deploy-correlation hook and metrics MCP server to investigate.
A lack of recent deploys is evidence too. Request the missing access or service
identity when it prevents a reliable diagnosis.

Perform a rollback only within the user's explicit request and the configured
rollback window. State the specific deploy and expected effect before execution.
After a change, check error rate and latency over a meaningful interval. Report
what recovered, what remains uncertain and the next decision. Do not treat a
successful API response as proof that the service recovered.
