import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MCPActivityFilter, UpdateMCPPolicyInput } from "./schema";

export const adminKeys = {
  access: (userId: string) => ["admin",userId,"access"] as const,
  services: (userId: string) => ["admin",userId,"mcp"] as const,
  activity: (userId: string,serviceId: string,filter: MCPActivityFilter) => ["admin",userId,"activity",serviceId,filter] as const,
};
export function adminAccessOptions(userId: string) { return queryOptions({ queryKey: adminKeys.access(userId), queryFn: () => api.getAdminAccess(), enabled: Boolean(userId), retry: false, staleTime: 30000 }); }
export function adminMCPServicesOptions(userId: string,enabled: boolean) { return queryOptions({ queryKey: adminKeys.services(userId), queryFn: () => api.listAdminMCPServices(), enabled: Boolean(userId && enabled), retry: false, refetchInterval: 15000 }); }
export function adminMCPActivityOptions(userId: string,serviceId: string,filter: MCPActivityFilter,enabled: boolean) { return queryOptions({ queryKey: adminKeys.activity(userId,serviceId,filter), queryFn: () => api.getAdminMCPActivity(serviceId,filter), enabled: Boolean(userId && serviceId && enabled), retry: false, refetchInterval: filter.cursor ? false : 15000 }); }
export function useUpdateMCPPolicy(userId: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ serviceId,input }: {serviceId: string; input: UpdateMCPPolicyInput}) => api.updateAdminMCPPolicy(serviceId,input), onSuccess: async () => { await Promise.all([client.invalidateQueries({queryKey:adminKeys.services(userId)}),client.invalidateQueries({queryKey:["admin",userId,"activity"]})]); } });
}
