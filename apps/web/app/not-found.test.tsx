import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotFound from "./not-found";

vi.mock("@/lib/request-locale", () => ({ getRequestLocale: async () => "zh-Hans" }));

describe("NotFound", () => {
  it("renders the not-found page without application providers", async () => {
    render(await NotFound());

    expect(
      screen.getByRole("heading", { name: "页面未找到" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("你要查找的页面不存在或已被移动。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回织个世界" })).toHaveAttribute(
      "href",
      "/?lang=zh-Hans",
    );
  });
});
