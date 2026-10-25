import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { LabelsTab } from "./labels-tab";
import { LabelManager } from "../../labels/label-manager";

vi.mock("@auro/core/hooks", () => ({
  useWorkspaceId: () => "workspace-1",
}));

const queried = vi.hoisted(() => ({ keys: [] as unknown[][] }));
vi.mock("@tanstack/react-query", () => ({
  queryOptions: <T,>(options: T) => options,
  useQuery: (options: { queryKey: unknown[] }) => {
    queried.keys.push(options.queryKey);
    return { data: [], isLoading: false };
  },
}));

vi.mock("@auro/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "workspace-1", name: "Acme" }),
}));

vi.mock("@auro/core/labels", () => ({
  labelListOptions: (wsId: string, resourceType: string) => ({
    queryKey: ["labels", wsId, "list", resourceType],
  }),
  useCreateLabel: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateLabel: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteLabel: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("Label catalogs", () => {
  afterEach(() => {
    cleanup();
    queried.keys = [];
  });

  it("exposes only the skill catalog", () => {
    renderWithI18n(<LabelsTab />);
    expect(queried.keys).toContainEqual(["labels", "workspace-1", "list", "skill"]);
    expect(queried.keys.some((key) => key.includes("issue") || key.includes("agent"))).toBe(false);
    expect(screen.queryByRole("tab", { name: /Issues/ })).toBeNull();
  });

  it("manages the skill catalog where it is mounted for skills", () => {
    renderWithI18n(<LabelManager scope="skill" />);

    expect(queried.keys).toContainEqual(["labels", "workspace-1", "list", "skill"]);
    expect(screen.getByRole("button", { name: /New label/ })).toBeInTheDocument();
  });
});
