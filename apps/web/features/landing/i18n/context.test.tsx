import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./context";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function LanguageChoice() {
  const { locale, setLocale } = useLocale();
  return <button onClick={() => setLocale("zh-Hans")}>{locale}</button>;
}

beforeEach(() => push.mockClear());

describe("landing language URLs", () => {
  it("keeps the page, query and anchor when choosing a language", () => {
    window.history.replaceState(null, "", "/about?ref=share#details");
    render(<LocaleProvider initialLocale="en"><LanguageChoice /></LocaleProvider>);

    fireEvent.click(screen.getByRole("button", { name: "en" }));

    expect(push).toHaveBeenCalledWith("/about?ref=share&lang=zh-Hans#details", { scroll: false });
  });

  it("follows the server locale when navigating between language URLs", () => {
    const view = render(<LocaleProvider initialLocale="en"><LanguageChoice /></LocaleProvider>);
    view.rerender(<LocaleProvider initialLocale="zh-Hans"><LanguageChoice /></LocaleProvider>);
    expect(screen.getByRole("button", { name: "zh-Hans" })).toBeInTheDocument();

    view.rerender(<LocaleProvider initialLocale="en"><LanguageChoice /></LocaleProvider>);
    expect(screen.getByRole("button", { name: "en" })).toBeInTheDocument();
  });
});
