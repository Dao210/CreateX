import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeBaselineStrategy } from "@auro/core/capture-the-flag";
import { renderWithI18n } from "../test/i18n";
import { StrategyImportDialog } from "./strategy-import-dialog";

const strategy = makeBaselineStrategy("test", "Test", "red");
const target = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  ownerId: "00000000-0000-4000-8000-000000000003",
  ownerName: "Author",
  name: "Test",
  revision: 3,
  hash: "a".repeat(64),
  published: true,
  archived: false,
  createdAt: "2026-11-15T00:00:00Z",
};
function selectFile(value: unknown, name = "Scout.strategy") {
  const file = new File([JSON.stringify(value)], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify(value),
  });
  const input = screen.getByRole("dialog").querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("strategy file workflow", () => {
  it("rejects a behavior report, then previews a replacement without saving or displaying code", async () => {
    const save = vi.fn(),
      saved = vi.fn();
    renderWithI18n(<StrategyImportDialog onSave={save} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Import strategy" }));
    selectFile(
      { engine: "local", strategy_sha256: "a".repeat(64), results: [] },
      "behavior.json",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "verification report",
    );
    expect(
      screen.getByRole("button", { name: "Import and save" }),
    ).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    selectFile(strategy);
    await screen.findByText("Ready to import");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("dialog").querySelector("textarea, pre, code"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Import and save" }),
    ).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });
  it("retains the file after a save error and retries the same frozen revision and request identity", async () => {
    const record = { ...target, revision: 4, published: false, strategy };
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(record);
    const saved = vi.fn();
    renderWithI18n(
      <StrategyImportDialog target={target} onSave={save} onSaved={saved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload new version" }));
    selectFile(strategy);
    await screen.findByText("Ready to import");
    fireEvent.click(screen.getByRole("button", { name: "Import and save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "selected file is ready to retry",
    );
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByText("Scout.strategy")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Import and save" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(record));
    expect(save.mock.calls[0]![0]).toEqual(save.mock.calls[1]![0]);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: target.id,
        expectedRevision: 3,
        name: "Scout",
        strategy,
        requestId: expect.any(String),
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps a pending import open until the server confirms the private save", async () => {
    let finish!: (
      record: typeof target & { strategy: typeof strategy },
    ) => void;
    const save = vi.fn(
      () =>
        new Promise<typeof target & { strategy: typeof strategy }>(
          (resolve) => {
            finish = resolve;
          },
        ),
    );
    renderWithI18n(<StrategyImportDialog onSave={save} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Import strategy" }));
    selectFile(strategy);
    await screen.findByText("Ready to import");
    fireEvent.click(screen.getByRole("button", { name: "Import and save" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeVisible();
    finish({ ...target, strategy });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
