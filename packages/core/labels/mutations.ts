import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { labelKeys } from "./queries";
import { useWorkspaceId } from "../hooks";
import { workspaceKeys } from "../workspace/queries";
import type { CreateLabelRequest, UpdateLabelRequest, ListLabelsResponse, LabelResourceType, ResourceLabelsResponse } from "../types";

export function useCreateLabel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (data: CreateLabelRequest) => api.createLabel(data),
    onSuccess: (label) => {
      qc.setQueryData<ListLabelsResponse>(labelKeys.list(wsId, label.resource_type ?? "skill"), (old) =>
        old && !old.labels.some((l) => l.id === label.id)
          ? { ...old, labels: [...old.labels, label], total: old.total + 1 }
          : old,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
    },
  });
}

/**
 * Optimistic rename/recolor. Matches the useUpdateProject pattern: apply the
 * change locally, snapshot for rollback, invalidate on settle. Without this
 * the UI freezes for the round-trip on every edit.
 */
export function useUpdateLabel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, resource_type: _resourceType, ...data }: { id: string; resource_type?: LabelResourceType } & UpdateLabelRequest) =>
      api.updateLabel(id, data),
    onMutate: async ({ id, resource_type = "skill", ...data }) => {
      const listKey = labelKeys.list(wsId, resource_type);
      await qc.cancelQueries({ queryKey: listKey });
      const prevList = qc.getQueryData<ListLabelsResponse>(listKey);
      qc.setQueryData<ListLabelsResponse>(listKey, (old) =>
        old
          ? {
              ...old,
              labels: old.labels.map((l) => (l.id === id ? { ...l, ...data } : l)),
            }
          : old,
      );
      return { prevList, listKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList && ctx.listKey) qc.setQueryData(ctx.listKey, ctx.prevList);
    },
    onSettled: () => {
      // Invalidate the entire labels scope so any byIssue cache holding a
      // stale copy of this label is refetched. The list cache is the source
      // of truth; byIssue views will re-render with the fresh data.
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
      // Issues and workspace skill lists embed label snapshots, so a
      // rename/recolor also has to refresh those caches.
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
    },
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (input: string | { id: string; resource_type: LabelResourceType }) =>
      api.deleteLabel(typeof input === "string" ? input : input.id),
    onMutate: async (input) => {
      const id = typeof input === "string" ? input : input.id;
      const resourceType = typeof input === "string" ? "skill" : input.resource_type;
      const listKey = labelKeys.list(wsId, resourceType);
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<ListLabelsResponse>(listKey);
      qc.setQueryData<ListLabelsResponse>(listKey, (old) =>
        old
          ? { ...old, labels: old.labels.filter((l) => l.id !== id), total: old.total - 1 }
          : old,
      );
      return { prev, listKey };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev && ctx.listKey) qc.setQueryData(ctx.listKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
      // A deleted label still lives in cached issue/skill.labels arrays
      // until we refetch — invalidate so list chips drop the orphan.
      qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) });
    },
  });
}

export function useAttachResourceLabel(
  resourceType: "agent" | "skill",
  resourceId: string,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (labelId: string) =>
      api.attachLabelToResource(resourceType, resourceId, labelId),
    onSuccess: (data: ResourceLabelsResponse) => {
      qc.setQueryData(
        labelKeys.byResource(wsId, resourceType, resourceId),
        data,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: workspaceKeysForLabels(resourceType, wsId) });
    },
  });
}

export function useDetachResourceLabel(
  resourceType: "agent" | "skill",
  resourceId: string,
) {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (labelId: string) =>
      api.detachLabelFromResource(resourceType, resourceId, labelId),
    onSuccess: (data: ResourceLabelsResponse) => {
      qc.setQueryData(
        labelKeys.byResource(wsId, resourceType, resourceId),
        data,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.all(wsId) });
      qc.invalidateQueries({ queryKey: workspaceKeysForLabels(resourceType, wsId) });
    },
  });
}

function workspaceKeysForLabels(resourceType: "agent" | "skill", wsId: string) {
  return ["workspaces", wsId, resourceType === "agent" ? "agents" : "skills"] as const;
}

