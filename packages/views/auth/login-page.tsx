"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@auro/ui/components/ui/card";
import { Alert, AlertDescription } from "@auro/ui/components/ui/alert";
import { Input } from "@auro/ui/components/ui/input";
import { Button } from "@auro/ui/components/ui/button";
import { Label } from "@auro/ui/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@auro/ui/components/ui/input-otp";
import { Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { workspaceKeys } from "@auro/core/workspace/queries";
import { api } from "@auro/core/api";
import type { User } from "@auro/core/types";
import { useT } from "../i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoogleAuthConfig {
  clientId: string;
  redirectUri: string;
  /** Opaque state passed through Google OAuth (e.g. "platform:desktop"). */
  state?: string;
}

interface CliCallbackConfig {
  /** Validated localhost callback URL */
  url: string;
  /** Opaque state to pass back to CLI */
  state: string;
}

interface LoginPageProps {
  /** Logo element rendered above the title */
  logo?: ReactNode;
  /** Called after successful login. The workspace list is seeded into React
   *  Query before this fires, so the caller can compute a destination URL. */
  onSuccess: () => void;
  /** Google OAuth config. Omit to disable Google login. */
  google?: GoogleAuthConfig;
  /** CLI callback config for authorizing CLI tools. */
  cliCallback?: CliCallbackConfig;
  /** Called after a token is obtained (e.g. to set cookies). */
  onTokenObtained?: () => void;
  /** Override Google login handler (e.g. desktop opens browser externally). When provided, renders the Google button even if `google` config is omitted. */
  onGoogleLogin?: () => void;
  /** Optional content below the mode links in the sign-in card. */
  extra?: ReactNode;
  /** Host owns the page layout; skip the full-screen centering wrapper. */
  embedded?: boolean;
  /** Host-specific framing for the initial email step (e.g. "Start creating"). */
  heading?: ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function redirectToCliCallback(url: string, token: string, state: string) {
  const separator = url.includes("?") ? "&" : "?";
  window.location.href = `${url}${separator}token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
}

/**
 * Validate that a CLI callback URL points to a safe host over HTTP.
 * Allows localhost and private/LAN IPs (RFC 1918) to support self-hosted setups
 * on local VMs while blocking arbitrary public hosts.
 */
export function validateCliCallback(cliCallback: string): boolean {
  try {
    const cbUrl = new URL(cliCallback);
    if (cbUrl.protocol !== "http:") return false;
    const h = cbUrl.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    // Allow RFC 1918 private IPs: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (/^10\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    return false;
  } catch {
    return false;
  }
}

function LoginFrame({
  embedded,
  children,
}: {
  embedded?: boolean;
  children: ReactNode;
}) {
  if (embedded) return <div className="w-full">{children}</div>;
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      {children}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LoginPage({
  logo,
  onSuccess,
  google,
  cliCallback,
  onTokenObtained,
  onGoogleLogin,
  extra,
  embedded,
  heading,
}: LoginPageProps) {
  const { t } = useT("auth");
  const qc = useQueryClient();
  const [step, setStep] = useState<"email" | "code" | "cli_confirm">("email");
  const [mode, setMode] = useState<"password" | "code" | "reset">("code");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const submittingRef = useRef(false);
  const settingPassword = mode === "reset";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [existingUser, setExistingUser] = useState<User | null>(null);
  // Tracks how the existing session was detected so handleCliAuthorize
  // uses the matching token source (cookie → issueCliToken, localStorage → direct).
  const authSourceRef = useRef<"cookie" | "localStorage">("cookie");
  // The last session ended because the server rejected its credential, not
  // because the user asked to leave. Without saying so, landing here reads as
  // the app having lost their work for no reason.
  const sessionExpired = useAuthStore((state) => state.expired);

  // Check for existing session when CLI callback is present.
  // Prioritises cookie auth (= current browser session) to avoid authorising
  // the CLI with a stale or mismatched localStorage token.
  useEffect(() => {
    if (!cliCallback) return;

    // Snapshot the token before probing. The probe below is *expected* to 401
    // for a token-mode session, and a 401 ends the session — clearing this
    // very key — so reading it after the probe would always come back null
    // and the fallback could never run.
    const storedToken = localStorage.getItem("auro_token");

    // Ensure no stale bearer token interferes — we want to test the cookie first.
    api.setToken(null);

    api
      .getMe()
      .then((user) => {
        authSourceRef.current = "cookie";
        setExistingUser(user);
        setStep("cli_confirm");
      })
      .catch(() => {
        // Cookie auth failed — fall back to the token this browser had.
        if (!storedToken) return;

        localStorage.setItem("auro_token", storedToken);
        api.setToken(storedToken);
        api
          .getMe()
          .then((user) => {
            authSourceRef.current = "localStorage";
            setExistingUser(user);
            setStep("cli_confirm");
          })
          .catch(() => {
            api.setToken(null);
            localStorage.removeItem("auro_token");
          });
      });
  }, [cliCallback]);

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const errorMessage = useCallback(
    (err: unknown, fallback: string) => {
      if (!(err instanceof Error)) return fallback;
      const message = err.message;
      if (/invalid email or password/i.test(message))
        return t(($) => $.errors.credentials_invalid);
      if (/password must contain/i.test(message))
        return t(($) => $.errors.password_length);
      if (/too many|wait before/i.test(message))
        return t(($) => $.errors.rate_limited);
      if (/invalid or expired code/i.test(message))
        return t(($) => $.errors.code_invalid);
      if (/failed to send verification code/i.test(message))
        return t(($) => $.errors.send_failed);
      if (/failed to (create user|verify code|generate token)/i.test(message))
        return t(($) => $.errors.login_failed);
      if (/user registration is disabled/i.test(message))
        return t(($) => $.errors.signup_prohibited);
      if (/email address or domain not allowed/i.test(message))
        return t(($) => $.errors.email_not_allowed);
      return message;
    },
    [t],
  );

  const changeMode = (next: typeof mode) => {
    setMode(next);
    setStep("email");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setCode("");
    setError("");
  };

  const finishLogin = useCallback(async () => {
    const wsList = await api.listWorkspaces();
    qc.setQueryData(workspaceKeys.list(), wsList);
    onTokenObtained?.();
    onSuccess();
  }, [qc, onTokenObtained, onSuccess]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError("");
    try {
      if (cliCallback) {
        const { token } = await api.loginWithPassword(email.trim(), password);
        localStorage.setItem("auro_token", token);
        api.setToken(token);
        onTokenObtained?.();
        redirectToCliCallback(cliCallback.url, token, cliCallback.state);
      } else {
        await useAuthStore.getState().loginWithPassword(email.trim(), password);
        setPassword("");
        await finishLogin();
      }
    } catch (err) {
      setError(errorMessage(err, t(($) => $.errors.login_failed)));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const requestCode = useCallback(
    async (fromPassword = false) => {
      if (submittingRef.current) return;
      const trimmed = email.trim();
      if (!trimmed) {
        setError(t(($) => $.common.email_required));
        return;
      }
      if (settingPassword) {
        if (
          [...password].length < 8 ||
          new TextEncoder().encode(password).length > 72
        ) {
          setError(t(($) => $.errors.password_length));
          return;
        }
        if (password !== confirmPassword) {
          setError(t(($) => $.errors.password_mismatch));
          return;
        }
      }
      submittingRef.current = true;
      setLoading(true);
      setError("");
      try {
        await useAuthStore.getState().sendCode(trimmed);
        if (fromPassword) setMode("code");
        setEmail(trimmed);
        setStep("code");
        setCode("");
        setCooldown(60);
      } catch (err) {
        setError(
          errorMessage(
            err,
            `${t(($) => $.errors.send_failed)} ${t(($) => $.errors.server_unreachable)}`,
          ),
        );
      } finally {
        submittingRef.current = false;
        setLoading(false);
      }
    },
    [email, settingPassword, password, confirmPassword, t, errorMessage],
  );

  const handleSendCode = (e: React.FormEvent) => {
    e.preventDefault();
    void requestCode();
  };

  const handleVerify = useCallback(
    async (value: string) => {
      if (value.length !== 6 || submittingRef.current) return;
      submittingRef.current = true;
      setLoading(true);
      setError("");
      try {
        if (cliCallback) {
          // CLI path: get token directly for the redirect URL
          const { token } = await api.verifyCode(
            email,
            value,
            settingPassword ? password : undefined,
          );
          localStorage.setItem("auro_token", token);
          api.setToken(token);
          onTokenObtained?.();
          redirectToCliCallback(cliCallback.url, token, cliCallback.state);
          return;
        }

        if (settingPassword) {
          await useAuthStore.getState().verifyCode(email, value, password);
        } else {
          await useAuthStore.getState().verifyCode(email, value);
        }
        setPassword("");
        setConfirmPassword("");
        await finishLogin();
      } catch (err) {
        setError(errorMessage(err, t(($) => $.errors.code_invalid)));
        setCode("");
      } finally {
        submittingRef.current = false;
        setLoading(false);
      }
    },
    [
      email,
      cliCallback,
      onTokenObtained,
      t,
      settingPassword,
      password,
      finishLogin,
      errorMessage,
    ],
  );

  const handleResend = async () => {
    if (cooldown > 0 || loading) return;
    setError("");
    setLoading(true);
    try {
      await useAuthStore.getState().sendCode(email);
      setCooldown(60);
    } catch (err) {
      setError(errorMessage(err, t(($) => $.errors.resend_failed)));
    } finally {
      setLoading(false);
    }
  };

  const handleCliAuthorize = async () => {
    if (!cliCallback) return;
    setLoading(true);

    try {
      let token: string;

      if (authSourceRef.current === "localStorage") {
        // Session was detected via localStorage — reuse that token directly.
        const stored = localStorage.getItem("auro_token");
        if (!stored) throw new Error("token missing");
        token = stored;
      } else {
        // Session was detected via cookie — obtain a bearer token from the server.
        const res = await api.issueCliToken();
        token = res.token;
      }

      onTokenObtained?.();
      redirectToCliCallback(cliCallback.url, token, cliCallback.state);
    } catch {
      setError(t(($) => $.errors.cli_auth_failed));
      setExistingUser(null);
      setStep("email");
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (onGoogleLogin) {
      onGoogleLogin();
      return;
    }
    if (!google) return;
    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: google.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    if (google.state) params.set("state", google.state);
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  const backToEmail = () => {
    setStep("email");
    setCode("");
    setError("");
  };

  // -------------------------------------------------------------------------
  // CLI confirm step
  // -------------------------------------------------------------------------

  if (step === "cli_confirm" && existingUser) {
    return (
      <LoginFrame embedded={embedded}>
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            {logo && <div className="mx-auto mb-4">{logo}</div>}
            <CardTitle
              className="text-display-sm"
              role="heading"
              aria-level={1}
            >
              {t(($) => $.cli.title)}
            </CardTitle>
            <CardDescription>
              {t(($) => $.cli.description, { email: existingUser.email })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleCliAuthorize}
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading
                ? t(($) => $.cli.authorizing)
                : t(($) => $.cli.authorize)}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setExistingUser(null);
                setStep("email");
              }}
            >
              {t(($) => $.cli.different_account)}
            </Button>
          </CardContent>
        </Card>
      </LoginFrame>
    );
  }

  // -------------------------------------------------------------------------
  // Code verification step
  // -------------------------------------------------------------------------

  if (step === "code") {
    return (
      <LoginFrame embedded={embedded}>
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            {logo && <div className="mx-auto mb-4">{logo}</div>}
            <CardTitle
              className="text-display-sm"
              role="heading"
              aria-level={1}
            >
              {t(($) => $.verify.title)}
            </CardTitle>
            <CardDescription>
              {t(($) => $.verify.description, { email })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <InputOTP
              autoFocus
              maxLength={6}
              aria-label={t(($) => $.verify.title)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-code-error" : undefined}
              autoComplete="one-time-code"
              value={code}
              onChange={(value) => {
                if (error) setError("");
                setCode(value);
                if (value.length === 6) handleVerify(value);
              }}
              disabled={loading}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="h-12 w-10 text-title-sm" />
                <InputOTPSlot index={1} className="h-12 w-10 text-title-sm" />
                <InputOTPSlot index={2} className="h-12 w-10 text-title-sm" />
                <InputOTPSlot index={3} className="h-12 w-10 text-title-sm" />
                <InputOTPSlot index={4} className="h-12 w-10 text-title-sm" />
                <InputOTPSlot index={5} className="h-12 w-10 text-title-sm" />
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <p
                id="login-code-error"
                role="alert"
                className="text-body text-destructive"
              >
                {error}
              </p>
            )}
            <div className="flex flex-col items-center gap-2 text-body text-muted-foreground">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {cooldown > 0
                  ? t(($) => $.verify.resend_cooldown, { seconds: cooldown })
                  : t(($) => $.verify.resend)}
              </button>
              <p className="text-center text-body-sm text-muted-foreground">
                {t(($) => $.verify.help)}
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Button
              type="button"
              variant="link"
              disabled={loading}
              onClick={backToEmail}
            >
              {t(($) => $.verify.change_email)}
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={loading}
              onClick={() => changeMode("password")}
            >
              {t(($) => $.password.use_password)}
            </Button>
          </CardFooter>
        </Card>
      </LoginFrame>
    );
  }

  // -------------------------------------------------------------------------
  // Email step
  // -------------------------------------------------------------------------

  const description =
    mode === "reset"
      ? t(($) => $.password.setup_description)
      : mode === "code"
        ? t(($) => $.signin.description)
        : null;
  const title =
    mode === "reset"
      ? t(($) => $.password.reset_title)
      : mode === "password"
        ? t(($) => $.password.signin_title)
        : (heading ?? t(($) => $.signin.title));
  const passwordDescribedBy =
    [
      settingPassword ? "password-hint" : "",
      error ? "login-error" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const canRecoverWithCode =
    mode === "password" && Boolean(error) && Boolean(email.trim());
  const submitLabel =
    mode === "password"
      ? loading
        ? t(($) => $.password.signing_in)
        : t(($) => $.password.sign_in)
      : loading
        ? t(($) => $.signin.sending)
        : t(($) => $.signin.continue);

  return (
    <LoginFrame embedded={embedded}>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {logo && <div className="mx-auto mb-4">{logo}</div>}
          <CardTitle
            className="text-display-sm"
            role="heading"
            aria-level={1}
          >
            {title}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionExpired && (
            <Alert>
              <AlertDescription>
                {t(($) => $.errors.session_expired)}
              </AlertDescription>
            </Alert>
          )}
          <form
            id="login-form"
            onSubmit={mode === "password" ? handlePasswordLogin : handleSendCode}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="login-email">{t(($) => $.common.email)}</Label>
              <Input
                id="login-email"
                type="email"
                placeholder={t(($) => $.common.email_placeholder)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                name="email"
                disabled={loading}
                required
                className="h-11"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            {mode !== "code" && (
              <div className="space-y-2">
                <Label htmlFor="login-password">
                  {settingPassword
                    ? t(($) => $.password.new_password)
                    : t(($) => $.password.label)}
                </Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      settingPassword ? "new-password" : "current-password"
                    }
                    autoFocus={mode === "password" && Boolean(email.trim())}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required
                    className="h-11 pr-10"
                    aria-invalid={Boolean(error)}
                    aria-describedby={passwordDescribedBy}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    aria-label={
                      showPassword
                        ? t(($) => $.password.hide)
                        : t(($) => $.password.show)
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </Button>
                </div>
                {settingPassword && (
                  <p
                    id="password-hint"
                    className="text-body-sm text-muted-foreground"
                  >
                    {t(($) => $.password.hint)}
                  </p>
                )}
              </div>
            )}
            {settingPassword && (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">
                  {t(($) => $.password.confirm)}
                </Label>
                <Input
                  id="confirm-password"
                  name="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  required
                  className="h-11"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
            )}
            {error && (
              <p
                id="login-error"
                role="alert"
                className="text-body text-destructive"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="h-12 w-full"
              size="lg"
              disabled={
                !email.trim() ||
                (mode === "password" && !password) ||
                (settingPassword && (!password || !confirmPassword)) ||
                loading
              }
              aria-busy={loading}
            >
              {submitLabel}
            </Button>
            {canRecoverWithCode && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={loading}
                onClick={() => void requestCode(true)}
              >
                {t(($) => $.password.use_code)}
              </Button>
            )}
            {(google || onGoogleLogin) && mode !== "reset" && (
              <>
                <div
                  className="relative flex items-center gap-3 py-1"
                  aria-hidden="true"
                >
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-body-sm text-muted-foreground">
                    {t(($) => $.signin.or)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full"
                  size="lg"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                >
                  <GoogleMark />
                  {t(($) => $.signin.google)}
                </Button>
              </>
            )}
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <div className="flex w-full flex-wrap justify-center gap-x-4 gap-y-1">
            {mode === "password" ? (
              <>
                {!error && (
                  <Button
                    type="button"
                    variant="link"
                    disabled={loading}
                    onClick={() => changeMode("code")}
                  >
                    {t(($) => $.password.use_code)}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="link"
                  disabled={loading}
                  onClick={() => changeMode("reset")}
                >
                  {t(($) => $.password.forgot)}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="link"
                disabled={loading}
                onClick={() => changeMode("password")}
              >
                {t(($) => $.password.use_password)}
              </Button>
            )}
          </div>
          {extra && (
            <div className="w-full pt-1 text-center">{extra}</div>
          )}
        </CardFooter>
      </Card>
    </LoginFrame>
  );
}
