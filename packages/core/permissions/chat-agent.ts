import type { Agent } from "../types";
import { canAssignAgentToIssue } from "./rules";

export function canChooseChatAgent(agent: Agent, userId: string | undefined, role: string | undefined): boolean {
  return canAssignAgentToIssue(agent, { userId: userId ?? null, role: role === "owner" || role === "admin" || role === "member" ? role : null }).allowed;
}
