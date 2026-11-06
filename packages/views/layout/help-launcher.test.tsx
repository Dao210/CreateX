import { cloneElement, type ReactElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enLayout from "../locales/en/layout.json";
import { DISCORD_URL } from "./discord";
import { HelpLauncher } from "./help-launcher";

// react-i18next isn't initialised in the views test env, so resolve the
// selector against the real en/layout.json to assert on actual copy.
vi.mock("../i18n", () => ({
  useT: () => ({
    t: (
      sel: (r: typeof enLayout) => string,
      vars?: Record<string, string>,
    ) => {
      const template = sel(enLayout);
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ""))
        : template;
    },
  }),
}));

// Follows the app-sidebar.test.tsx convention of flattening the Base UI
// dropdown primitives to plain children so the menu content is always in
// the DOM, instead of exercising the real portal/open-state interaction.
//
// The mock deliberately preserves ONE real invariant: DropdownMenuItem adopts
// the `render` prop's element (here the <a>) and its children. Flattening it
// to a bare fragment would drop the anchor entirely and make an href
// assertion silently unfalsifiable.
vi.mock("@auro/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    render,
  }: {
    children: ReactNode;
    render?: ReactElement;
  }) => (render ? cloneElement(render, undefined, children) : <>{children}</>),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("HelpLauncher", () => {
  it("keeps Discord and Feedback while omitting the retired entries", () => {
    render(<HelpLauncher />);
    expect(screen.getByRole("link", { name: /Discord/ })).toHaveAttribute(
      "href",
      DISCORD_URL,
    );
    expect(screen.getByText("Feedback")).toBeInTheDocument();

    for (const label of ["Desktop app", "Docs", "Change log", "Server version"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});
