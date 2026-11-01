import type { Agent } from "../types";
import { canInvokeAgent } from "./rules";

export function canChooseChatAgent(agent: Agent, userId: string | undefined, role: string | undefined): boolean {
  return canInvokeAgent(agent, { userId: userId ?? null, role: role === "owner" || role === "admin" || role === "member" ? role : null }).allowed;
}
