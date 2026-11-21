import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginShell } from "./login-shell";

describe("LoginShell", () => {
  it.each(["tank", "fish", "resident"] as const)("continues the homepage's %s context", creation => {
    render(<LoginShell locale="en" creation={creation}><div>login form</div></LoginShell>);
    expect(screen.getByText("login form")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining(`/gameplay/${creation}.`));
    expect(document.querySelector("video, canvas")).toBeNull();
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute("href", "/?lang=en#games");
  });

  it("keeps Chinese branding and legal links in the current language", () => {
    render(<LoginShell locale="zh-Hans" creation={null}><div>form</div></LoginShell>);
    expect(screen.getByRole("link", { name: "织个世界" })).toHaveAttribute("href", "/?lang=zh-Hans");
    expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute("href", "/privacy?lang=zh-Hans");
    expect(screen.getByRole("link", { name: "服务条款" })).toHaveAttribute("href", "/terms?lang=zh-Hans");
  });
});
