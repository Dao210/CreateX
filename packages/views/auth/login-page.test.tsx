import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "@auro/core/i18n/react";
import enCommon from "../locales/en/common.json";
import enAuth from "../locales/en/auth.json";
import enSettings from "../locales/en/settings.json";

const TEST_RESOURCES = {
  en: { common: enCommon, auth: enAuth, settings: enSettings },
};

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

function renderWithI18n(ui: ReactElement) {
  return render(ui, { wrapper: I18nWrapper });
}

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockSendCode = vi.hoisted(() => vi.fn());
const mockPasswordLogin = vi.hoisted(() => vi.fn());
const mockApiPasswordLogin = vi.hoisted(() => vi.fn());
const mockVerifyCode = vi.hoisted(() => vi.fn());
const mockApiListWorkspaces = vi.hoisted(() => vi.fn());
const mockApiVerifyCode = vi.hoisted(() => vi.fn());
const mockApiSetToken = vi.hoisted(() => vi.fn());
const mockApiGetMe = vi.hoisted(() => vi.fn());
const mockApiIssueCliToken = vi.hoisted(() => vi.fn());
const mockSetQueryData = vi.hoisted(() => vi.fn());
// Mutable slice of auth state the component subscribes to.
const mockAuthState = vi.hoisted(() => ({ expired: false }));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQueryClient: () => ({ setQueryData: mockSetQueryData }) };
});

vi.mock("@auro/core/auth", () => ({
  useAuthStore: Object.assign(
    // Zustand hook form — component may call useAuthStore(selector)
    (selector?: (s: unknown) => unknown) => {
      const state = {
        sendCode: mockSendCode,
        verifyCode: mockVerifyCode,
        loginWithPassword: mockPasswordLogin,
        expired: mockAuthState.expired,
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        sendCode: mockSendCode,
        verifyCode: mockVerifyCode,
        loginWithPassword: mockPasswordLogin,
      }),
    },
  ),
}));

vi.mock("@auro/core/api", () => ({
  api: {
    listWorkspaces: mockApiListWorkspaces,
    verifyCode: mockApiVerifyCode,
    loginWithPassword: mockApiPasswordLogin,
    setToken: mockApiSetToken,
    getMe: mockApiGetMe,
    issueCliToken: mockApiIssueCliToken,
  },
}));

vi.mock("@auro/core/types", () => ({}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { LoginPage, validateCliCallback } from "./login-page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOTPInput() {
  // input-otp renders a single hidden <input> that holds the OTP value
  return screen.getByRole("textbox", { hidden: true });
}

async function switchToPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /use a password instead/i }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockAuthState.expired = false;
    onSuccess.mockClear();
    // Default: no existing session (getMe rejects when no auth)
    mockApiGetMe.mockRejectedValue(new Error("unauthorized"));
    localStorage.clear();
    // Reset window.location for tests that change it
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "http://localhost:3000" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Email step rendering
  // -------------------------------------------------------------------------

  it("says the session expired when that is why the user is here", () => {
    mockAuthState.expired = true;
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    expect(
      screen.getByText(/your session expired/i),
    ).toBeInTheDocument();
  });

  it("stays quiet on an ordinary visit to the login page", () => {
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    expect(screen.queryByText(/your session expired/i)).not.toBeInTheDocument();
  });

  it("renders the code-first email form", () => {
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    expect(
      screen.getByText(/sign in to weave a world/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/verifying creates your account/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/^password$/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^send code$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create an account/i }),
    ).not.toBeInTheDocument();
  });

  it("uses a host heading for the initial code step", () => {
    renderWithI18n(
      <LoginPage onSuccess={onSuccess} heading="Start creating" />,
    );
    expect(
      screen.getByRole("heading", { name: "Start creating" }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Email validation
  // -------------------------------------------------------------------------

  it("signs in with a password and seeds workspaces before navigation", async () => {
    mockPasswordLogin.mockResolvedValueOnce({ id: "u-1" });
    mockApiListWorkspaces.mockResolvedValueOnce([{ id: "ws-1" }]);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await switchToPassword(user);
    await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
    await user.type(screen.getByLabelText(/^password$/i), " secret password ");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mockPasswordLogin).toHaveBeenCalledWith("alice@example.com", " secret password ");
    expect(mockSetQueryData).toHaveBeenCalledWith(expect.any(Array), [{ id: "ws-1" }]);
    expect(mockSendCode).not.toHaveBeenCalled();
  });

  it("keeps the password form available after rejected credentials", async () => {
    mockPasswordLogin.mockRejectedValueOnce(new Error("invalid email or password"));
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await switchToPassword(user);
    await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect email or password/i);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /email me a code instead/i }),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("sends a code from the password error state in one click", async () => {
    mockPasswordLogin.mockRejectedValueOnce(new Error("invalid email or password"));
    mockSendCode.mockResolvedValueOnce(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await switchToPassword(user);
    await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    const recovery = await screen.findByRole("button", {
      name: /email me a code instead/i,
    });
    await user.click(recovery);
    expect(mockSendCode).toHaveBeenCalledWith("alice@example.com");
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("verifies email before setting a password via Forgot or need to set a password?", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    mockVerifyCode.mockResolvedValueOnce({ id: "u-1" });
    mockApiListWorkspaces.mockResolvedValueOnce([]);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await switchToPassword(user);
    await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
    await user.click(
      screen.getByRole("button", {
        name: /forgot or need to set a password/i,
      }),
    );
    await user.type(screen.getByLabelText(/^new password$/i), "new-password");
    await user.type(screen.getByLabelText(/^confirm password$/i), "other-password");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/passwords do not match/i);
    expect(mockSendCode).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(/^confirm password$/i));
    await user.type(screen.getByLabelText(/^confirm password$/i), "new-password");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));
    expect(mockVerifyCode).not.toHaveBeenCalled();
    await user.type(getOTPInput(), "123456");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(mockVerifyCode).toHaveBeenCalledWith("alice@example.com", "123456", "new-password");
  });

  it("supports password login for CLI authorization", async () => {
    mockApiPasswordLogin.mockResolvedValueOnce({ token: "cli-password-token" });
    renderWithI18n(<LoginPage onSuccess={onSuccess} cliCallback={{ url: "http://localhost:9876/callback", state: "state-1" }} />);
    const user = userEvent.setup();
    await switchToPassword(user);
    await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "password-123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(window.location.href).toContain("token=cli-password-token&state=state-1"));
    expect(mockApiListWorkspaces).not.toHaveBeenCalled();
  });

  it("keeps submit disabled until the required fields are filled", async () => {
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    const user = userEvent.setup();
    const emailInput = screen.getByLabelText(/email/i);
    const sendCode = screen.getByRole("button", { name: /^send code$/i });
    expect(sendCode).toBeDisabled();

    await user.type(emailInput, "test@example.com");
    expect(sendCode).toBeEnabled();
    await user.clear(emailInput);
    expect(sendCode).toBeDisabled();

    await switchToPassword(user);
    const signIn = screen.getByRole("button", { name: /^sign in$/i });
    expect(signIn).toBeDisabled();
    await user.type(screen.getByLabelText(/^password$/i), "correct-password");
    expect(signIn).toBeDisabled();
    await user.type(emailInput, "test@example.com");
    expect(signIn).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // sendCode flow
  // -------------------------------------------------------------------------

  it("calls sendCode on form submit with email", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    expect(mockSendCode).toHaveBeenCalledWith("test@example.com");
  });

  it("shows 'Sending code...' while submitting", async () => {
    // Never resolve so loading stays true
    mockSendCode.mockReturnValueOnce(new Promise(() => {}));
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    expect(screen.getByText(/sending code/i)).toBeInTheDocument();
  });

  it("transitions to code step after successful sendCode", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
  });

  it("can switch from the code step to password sign-in", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /use a password instead/i }),
    );

    expect(
      screen.getByText(/sign in with a password/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("localizes a server send failure", async () => {
    mockSendCode.mockRejectedValueOnce(
      new Error("failed to send verification code"),
    );
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /failed to send code/i,
    );
  });

  it("autofocuses the OTP input when the code step opens", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });

    // The OTP field should be focused on mount so the user can type the code
    // without clicking it first — important when repeatedly switching accounts.
    expect(getOTPInput()).toHaveFocus();
  });

  it("shows error when sendCode fails", async () => {
    mockSendCode.mockRejectedValueOnce(new Error("please wait before requesting another code"));
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/too many attempts/i),
      ).toBeInTheDocument();
    });
  });

  it("shows generic error when sendCode throws non-Error", async () => {
    mockSendCode.mockRejectedValueOnce("boom");
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/failed to send code/i),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Code verification
  // -------------------------------------------------------------------------

  it("calls verifyCode, seeds workspace list cache, then onSuccess", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    mockVerifyCode.mockResolvedValueOnce(undefined);
    mockApiListWorkspaces.mockResolvedValueOnce([{ id: "ws-1" }]);

    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    // Step 1: email
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    // Step 2: code
    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });

    const otpInput = getOTPInput();
    await user.type(otpInput, "123456");

    await waitFor(() => {
      expect(mockVerifyCode).toHaveBeenCalledWith(
        "test@example.com",
        "123456",
      );
      expect(mockApiListWorkspaces).toHaveBeenCalled();
      // The workspace list is seeded into React Query so onSuccess can read
      // it synchronously to compute a destination URL.
      expect(mockSetQueryData).toHaveBeenCalledWith(
        expect.arrayContaining(["workspaces", "list"]),
        [{ id: "ws-1" }],
      );
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("shows error on invalid code", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    mockVerifyCode.mockRejectedValueOnce(new Error("invalid or expired code"));

    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });

    const otpInput = getOTPInput();
    await user.type(otpInput, "000000");

    await waitFor(() => {
      expect(
        screen.getByText(/invalid or expired code/i),
      ).toBeInTheDocument();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Resend code with cooldown
  // -------------------------------------------------------------------------

  it("disables resend button during cooldown", async () => {
    mockSendCode.mockResolvedValue(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });

    // After transitioning to code step, cooldown is 60s
    const resendBtn = screen.getByRole("button", { name: /resend in/i });
    expect(resendBtn).toBeDisabled();
  });

  it("calls sendCode again when resend is clicked after cooldown", async () => {
    mockSendCode.mockResolvedValue(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });

    // sendCode was called once for the initial send
    expect(mockSendCode).toHaveBeenCalledTimes(1);

    // Advance past the 60s cooldown one second at a time so React can
    // process each setCooldown state update between ticks.
    for (let i = 0; i < 61; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
    }

    await waitFor(() => {
      expect(screen.getByText(/resend code/i)).toBeInTheDocument();
    });

    const resendBtn = screen.getByRole("button", { name: /resend code/i });
    expect(resendBtn).not.toBeDisabled();

    await user.click(resendBtn);
    expect(mockSendCode).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------------

  it("renders Google OAuth button when google prop provided", () => {
    render(
      <LoginPage
        onSuccess={onSuccess}
        google={{ clientId: "goog-123", redirectUri: "http://localhost/cb" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("hides Google OAuth button when google prop omitted", () => {
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // CLI callback — existing session
  // -------------------------------------------------------------------------

  it("shows cli_confirm step when existing session + cliCallback", async () => {
    localStorage.setItem("auro_token", "existing-jwt");
    // Cookie attempt fails first, then localStorage fallback succeeds
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    render(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/authorize cli/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /authorize/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use a different account/i }),
    ).toBeInTheDocument();
  });

  it("still finds the stored token after the cookie probe's 401 clears it", async () => {
    localStorage.setItem("auro_token", "existing-jwt");
    // The cookie probe 401s, and a 401 ends the session — which wipes the very
    // key the localStorage fallback is about to look for. The component has to
    // have read it before probing, or token-mode users can never authorize a
    // CLI (they land on the email step instead).
    mockApiGetMe
      .mockImplementationOnce(() => {
        localStorage.removeItem("auro_token");
        return Promise.reject(new Error("no cookie"));
      })
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    render(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/authorize cli/i)).toBeInTheDocument();
    });
    expect(mockApiSetToken).toHaveBeenCalledWith("existing-jwt");
    expect(localStorage.getItem("auro_token")).toBe("existing-jwt");
  });

  it("CLI authorize button redirects to callback URL", async () => {
    localStorage.setItem("auro_token", "existing-jwt");
    // Cookie attempt fails, localStorage fallback succeeds
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });
    const onTokenObtained = vi.fn();

    render(
      <LoginPage
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/authorize cli/i),
      ).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^authorize$/i }));

    expect(onTokenObtained).toHaveBeenCalled();
    expect(window.location.href).toContain(
      "http://localhost:9876/callback?token=existing-jwt&state=abc",
    );
  });

  it("'Use a different account' returns to email step", async () => {
    localStorage.setItem("auro_token", "existing-jwt");
    // Cookie attempt fails, localStorage fallback succeeds
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    render(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/authorize cli/i),
      ).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /use a different account/i }),
    );

    expect(
      screen.getByText(/sign in to weave a world/i),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // CLI callback — cookie-based session (no localStorage token)
  // -------------------------------------------------------------------------

  it("detects cookie-based session and shows cli_confirm when no localStorage token", async () => {
    // No localStorage token — getMe succeeds via HttpOnly cookie
    mockApiGetMe.mockResolvedValueOnce({
      id: "u-1",
      email: "cookie@example.com",
      name: "Cookie User",
    });

    render(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/authorize cli/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/cookie@example.com/)).toBeInTheDocument();
  });

  it("CLI authorize with cookie session calls issueCliToken and redirects", async () => {
    // No localStorage token — getMe succeeds via cookie
    mockApiGetMe.mockResolvedValueOnce({
      id: "u-1",
      email: "cookie@example.com",
      name: "Cookie User",
    });
    mockApiIssueCliToken.mockResolvedValueOnce({ token: "fresh-jwt" });
    const onTokenObtained = vi.fn();

    render(
      <LoginPage
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/authorize cli/i)).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^authorize$/i }));

    await waitFor(() => {
      expect(mockApiIssueCliToken).toHaveBeenCalled();
      expect(onTokenObtained).toHaveBeenCalled();
      expect(window.location.href).toContain(
        "http://localhost:9876/callback?token=fresh-jwt&state=abc",
      );
    });
  });

  // -------------------------------------------------------------------------
  // CLI callback — code verification redirects
  // -------------------------------------------------------------------------

  it("CLI code verification redirects to callback URL", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    mockApiVerifyCode.mockResolvedValueOnce({ token: "new-jwt-token" });
    const onTokenObtained = vi.fn();

    render(
      <LoginPage
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "xyz" }}
      />,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "cli@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });

    const otpInput = getOTPInput();
    await user.type(otpInput, "654321");

    await waitFor(() => {
      expect(mockApiVerifyCode).toHaveBeenCalledWith(
        "cli@example.com",
        "654321",
        undefined,
      );
      expect(onTokenObtained).toHaveBeenCalled();
      expect(window.location.href).toContain(
        "http://localhost:9876/callback?token=new-jwt-token&state=xyz",
      );
    });

    // Normal verifyCode should NOT be called in CLI path
    expect(mockVerifyCode).not.toHaveBeenCalled();
    // onSuccess should NOT be called in CLI path — redirect handles it
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Logo prop
  // -------------------------------------------------------------------------

  it("renders logo when provided", () => {
    render(
      <LoginPage
        onSuccess={onSuccess}
        logo={<div data-testid="custom-logo">Logo</div>}
      />,
    );
    expect(screen.getByTestId("custom-logo")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // onTokenObtained callback
  // -------------------------------------------------------------------------

  it("calls onTokenObtained after successful verification", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    mockVerifyCode.mockResolvedValueOnce(undefined);
    mockApiListWorkspaces.mockResolvedValueOnce([{ id: "ws-1" }]);
    const onTokenObtained = vi.fn();

    render(
      <LoginPage
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
      />,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });

    const otpInput = getOTPInput();
    await user.type(otpInput, "123456");

    await waitFor(() => {
      expect(onTokenObtained).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Back button on code step
  // -------------------------------------------------------------------------

  it("change email returns to the email step", async () => {
    mockSendCode.mockResolvedValueOnce(undefined);
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.click(screen.getByRole("button", { name: /^send code$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/check your email/i),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /change email/i }));

    expect(
      screen.getByText(/sign in to weave a world/i),
    ).toBeInTheDocument();
  });

});

// ---------------------------------------------------------------------------
// validateCliCallback (exported helper)
// ---------------------------------------------------------------------------

describe("validateCliCallback", () => {
  it("accepts http://localhost", () => {
    expect(validateCliCallback("http://localhost:9876/callback")).toBe(true);
  });

  it("accepts http://127.0.0.1", () => {
    expect(validateCliCallback("http://127.0.0.1:8080/cb")).toBe(true);
  });

  it("accepts 10.x.x.x private IPs", () => {
    expect(validateCliCallback("http://10.0.0.5:9876/callback")).toBe(true);
    expect(validateCliCallback("http://10.255.255.255:1234/cb")).toBe(true);
  });

  it("accepts 172.16-31.x.x private IPs", () => {
    expect(validateCliCallback("http://172.16.0.1:9876/callback")).toBe(true);
    expect(validateCliCallback("http://172.31.255.255:1234/cb")).toBe(true);
  });

  it("rejects 172.x outside 16-31 range", () => {
    expect(validateCliCallback("http://172.15.0.1:9876/callback")).toBe(false);
    expect(validateCliCallback("http://172.32.0.1:9876/callback")).toBe(false);
  });

  it("accepts 192.168.x.x private IPs", () => {
    expect(validateCliCallback("http://192.168.1.131:41117/callback")).toBe(true);
    expect(validateCliCallback("http://192.168.0.1:8080/cb")).toBe(true);
  });

  it("rejects https:// URLs", () => {
    expect(validateCliCallback("https://localhost:9876/callback")).toBe(false);
  });

  it("rejects public IPs and domains", () => {
    expect(validateCliCallback("http://evil.com:9876/callback")).toBe(false);
    expect(validateCliCallback("http://8.8.8.8:9876/callback")).toBe(false);
    expect(validateCliCallback("http://192.169.1.1:9876/callback")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(validateCliCallback("not-a-url")).toBe(false);
  });
});
