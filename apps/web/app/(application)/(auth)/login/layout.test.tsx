import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@auro/core/i18n/react";
import enAuth from "@auro/views/locales/en/auth.json";
import LoginLayout from "./layout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

function renderLayout() {
  return render(
    <LoginLayout>
      <div data-testid="login-form">form</div>
    </LoginLayout>,
    {
      wrapper: ({ children }) => (
        <I18nProvider locale="en" resources={{ en: { auth: enAuth } }}>
          {children}
        </I18nProvider>
      ),
    },
  );
}

describe("LoginLayout", () => {
  it("renders the branded world preview and the form", () => {
    renderLayout();

    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /world preview map/i })).toBeInTheDocument();
    expect(screen.getAllByText("Preview").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /back/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/your creations change the world/i)).toBeInTheDocument();
  });

  it("links the legal note to the privacy policy", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });
});
