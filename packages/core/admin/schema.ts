import { z } from "zod";

export const AdminAccessSchema = z.object({ isAdmin: z.boolean(), configured: z.boolean().default(false) });
export const MCPPolicySchema = z.object({
  serviceId: z.string().min(1), enabled: z.boolean(), disabledTools: z.array(z.string()).default([]), revision: z.number().int().nonnegative(),
  updatedBy: z.string().optional(), updatedAt: z.string().datetime({ offset: true }).nullish(),
});
const StatsSchema = z.object({ calls: z.number().nonnegative().default(0), errors: z.number().nonnegative().default(0), blocked: z.number().nonnegative().default(0), averageMs: z.number().nonnegative().default(0), lastCalledAt: z.string().datetime({ offset: true }).nullish() });
export const MCPAdminServicesSchema = z.object({ services: z.array(z.object({
  id: z.string().min(1), name: z.string(), endpoint: z.string().startsWith("/api/"), protocolVersion: z.string(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.unknown()), readOnly: z.boolean().default(false) })),
  policy: MCPPolicySchema, stats: StatsSchema, toolStats: z.record(z.string(), StatsSchema).default({}),
})) });
export const MCPActivityPageSchema = z.object({ items: z.array(z.object({
  id: z.string().uuid(), serviceId: z.string(), workspaceId: z.string().optional(), workspaceName: z.string().default(""), workspaceSlug: z.string().default(""),
  actorId: z.string().uuid(), actorName: z.string().default(""), actorEmail: z.string().default(""),
  kind: z.string(), toolName: z.string().default(""), outcome: z.string(), errorCode: z.string().default(""), durationMs: z.number().nonnegative(),
  details: z.record(z.string(),z.unknown()).default({}), occurredAt: z.string().datetime({ offset: true }),
})), nextCursor: z.string().optional() });
export type AdminAccess = z.infer<typeof AdminAccessSchema>;
export type MCPPolicy = z.infer<typeof MCPPolicySchema>;
export type MCPAdminService = z.infer<typeof MCPAdminServicesSchema>["services"][number];
export type MCPActivityPage = z.infer<typeof MCPActivityPageSchema>;
export type MCPActivity = MCPActivityPage["items"][number];
export interface UpdateMCPPolicyInput { expectedRevision: number; enabled: boolean; disabledTools: string[] }
export interface MCPActivityFilter { tool?: string; outcome?: string; workspaceId?: string; cursor?: string }
