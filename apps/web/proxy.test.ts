import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { AURO_LOCALE_HEADER } from "./lib/locale-routing";
import { config, proxy } from "./proxy";

function makeRequest(
  path: string,
  cookies: Record<string, string> = {},
  host = "app.auro.test",
) {
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

  return new NextRequest(`https://${host}${path}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

function redirectLocation(
  path: string,
  cookies: Record<string, string> = {},
  host?: string,
) {
  return proxy(makeRequest(path, cookies, host)).headers.get("location");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function withoutRuntimeUpstreams(run: () => void) {
  const previousRemoteApiUrl = process.env.REMOTE_API_URL;
  const previousDocsUrl = process.env.DOCS_URL;
  const previousPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const previousPort = process.env.PORT;
  delete process.env.REMOTE_API_URL;
  delete process.env.DOCS_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  process.env.PORT = "3000";

  try {
    run();
  } finally {
    restoreEnv("REMOTE_API_URL", previousRemoteApiUrl);
    restoreEnv("DOCS_URL", previousDocsUrl);
    restoreEnv("NEXT_PUBLIC_API_URL", previousPublicApiUrl);
    restoreEnv("PORT", previousPort);
  }
}

describe("proxy legacy workspace route redirects", () => {
  const sessionCookies = {
    auro_logged_in: "1",
    last_workspace_slug: "acme",
  };

  it("does not recreate retired personal issue routes through legacy redirects", () => {
    expect(redirectLocation("/my-issues?view=old", sessionCookies)).toBeNull();
    expect(redirectLocation("/acme/my-issues?view=old", sessionCookies)).toBeNull();
  });

  it.each<Record<string, string>>([{}, sessionCookies, { auro_logged_in: "1" }])("does not redirect retired squad URLs for session %j", (cookies) => {
    expect(redirectLocation("/squads?view=members", cookies)).toBeNull();
    expect(redirectLocation("/squads/old-id", cookies)).toBeNull();
    expect(redirectLocation("/acme/squads/old-id", cookies)).toBeNull();
  });

  it.each([
    ["agents", "/acme/agents"],
    ["inbox", "/acme/inbox"],
    ["autopilots", "/acme/autopilots"],
    ["runtimes", "/acme/runtimes"],
    ["skills", "/acme/skills"],
    ["settings", "/acme/settings"],
    ["usage", "/acme/usage"],
  ])(
    "redirects legacy /%s URLs through the last workspace slug",
    (segment, expectedPath) => {
      expect(redirectLocation(`/${segment}?tab=all`, sessionCookies)).toBe(
        `https://app.auro.test${expectedPath}?tab=all`,
      );
    },
  );

  it("preserves nested legacy paths and query strings", () => {
    expect(
      redirectLocation("/agents/agent-123?view=details", sessionCookies),
    ).toBe("https://app.auro.test/acme/agents/agent-123?view=details");
  });

  it("sends logged-out legacy URLs to login", () => {
    expect(redirectLocation("/usage?tab=billing")).toBe(
      "https://app.auro.test/login?tab=billing",
    );
  });

  it("sends logged-in legacy URLs without a last workspace cookie to login", () => {
    // Not root: the root-path rule below leaves "/" on the public site for the
    // official marketing hosts even with a session, so bouncing there would
    // dead-end on the landing page. /login resolves against the workspace list
    // instead. The deep-link query is dropped because feeding a legacy path
    // back through `next` would return here and loop.
    expect(
      redirectLocation("/agents?view=details", { auro_logged_in: "1" }),
    ).toBe("https://app.auro.test/login");
  });

  it.each(["weavea.world", "www.weavea.world", "auro.ai", "www.auro.ai"])(
    "resolves a slugless session off the marketing host %s instead of stranding it",
    (host) => {
      expect(
        redirectLocation("/inbox", { auro_logged_in: "1" }, host),
      ).toBe(`https://${host}/login`);
    },
  );

  it("does not redirect workspace-scoped URLs whose first segment is already a slug", () => {
    expect(redirectLocation("/acme/agents", sessionCookies)).toBeNull();
  });

  it("redirects app-host root URLs to the last workspace", () => {
    expect(redirectLocation("/", sessionCookies)).toBe(
      "https://app.auro.test/acme/chat",
    );
  });

  it.each(["weavea.world", "www.weavea.world", "auro.ai", "www.auro.ai"])(
    "does not redirect public marketing root on %s",
    (host) => {
      expect(redirectLocation("/", sessionCookies, host)).toBeNull();
    },
  );

  it("still redirects explicit legacy app routes on the public marketing host", () => {
    expect(redirectLocation("/agents/abc", sessionCookies, "auro.ai")).toBe(
      "https://auro.ai/acme/agents/abc",
    );
  });
});

describe("proxy runtime upstream rewrites", () => {
  it("matches globally versioned Plugin API requests", () => {
    expect(config.matcher).toContain("/v1/:path*");
  });

  it("does not rewrite API requests when no runtime API origin is configured", () => {
    withoutRuntimeUpstreams(() => {
      const res = proxy(makeRequest("/api/config?x=1"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(
        res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`),
      ).toBe("en");
    });
  });

  it("does not rewrite Plugin API requests when no runtime API origin is configured", () => {
    withoutRuntimeUpstreams(() => {
      const res = proxy(makeRequest("/v1/context?x=1"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    });
  });

  it("does not rewrite docs requests when no runtime docs origin is configured", () => {
    withoutRuntimeUpstreams(() => {
      const res = proxy(makeRequest("/docs/zh"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(
        res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`),
      ).toBe("en");
    });
  });

  it("rewrites API requests to the runtime API origin", () => {
    const previous = process.env.REMOTE_API_URL;
    process.env.REMOTE_API_URL = "http://backend:8080";
    try {
      const res = proxy(makeRequest("/api/config?x=1"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        "http://backend:8080/api/config?x=1",
      );
    } finally {
      restoreEnv("REMOTE_API_URL", previous);
    }
  });

  it("rewrites the CLI health probe to the runtime API origin", () => {
    const previous = process.env.REMOTE_API_URL;
    process.env.REMOTE_API_URL = "http://backend:8080";
    try {
      const res = proxy(makeRequest("/health"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        "http://backend:8080/health",
      );
    } finally {
      restoreEnv("REMOTE_API_URL", previous);
    }
  });

  it("rewrites Plugin API requests to the runtime API origin", () => {
    const previous = process.env.REMOTE_API_URL;
    process.env.REMOTE_API_URL = "http://backend:8080";
    try {
      const res = proxy(makeRequest("/v1/issues/MUL-6581?x=1"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        "http://backend:8080/v1/issues/MUL-6581?x=1",
      );
    } finally {
      restoreEnv("REMOTE_API_URL", previous);
    }
  });

  it("rewrites docs requests to the runtime docs origin", () => {
    const previous = process.env.DOCS_URL;
    process.env.DOCS_URL = "http://docs:4000";
    try {
      const res = proxy(makeRequest("/docs/zh/agents"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        "http://docs:4000/docs/zh/agents",
      );
    } finally {
      restoreEnv("DOCS_URL", previous);
    }
  });

  it("rewrites websocket requests to the runtime API origin", () => {
    const previous = process.env.REMOTE_API_URL;
    process.env.REMOTE_API_URL = "http://backend:8080";
    try {
      const res = proxy(makeRequest("/ws"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        "http://backend:8080/ws",
      );
    } finally {
      restoreEnv("REMOTE_API_URL", previous);
    }
  });

  it("does not rewrite frontend auth callback pages", () => {
    const previous = process.env.REMOTE_API_URL;
    process.env.REMOTE_API_URL = "http://backend:8080";
    try {
      const res = proxy(makeRequest("/auth/callback"));

      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(
        res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`),
      ).toBe("en");
    } finally {
      restoreEnv("REMOTE_API_URL", previous);
    }
  });
});

describe("proxy root and locale handling", () => {
  it.each(["/", "/about"])("uses the actual marketing copy language on %s for French preferences", (path) => {
    const res = proxy(makeRequest(`${path}?lang=fr`, { "auro-locale": "fr" }));
    expect(res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`)).toBe("en");
    expect(res.cookies.get("auro-locale")).toBeUndefined();
  });

  it("keeps French available in application routes", () => {
    const res = proxy(makeRequest("/login?lang=fr"));
    expect(res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`)).toBe("fr");
    expect(res.cookies.get("auro-locale")?.value).toBe("fr");
  });

  it("remembers explicit language URLs without JavaScript", () => {
    const res = proxy(makeRequest("/about?lang=ja", { "auro-locale": "en" }));
    expect(res.cookies.get("auro-locale")?.value).toBe("ja");
    expect(res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`)).toBe("ja");
  });

  it("does not persist invalid language parameters", () => {
    expect(proxy(makeRequest("/about?lang=invalid")).cookies.get("auro-locale")).toBeUndefined();
  });
  it("redirects logged-in root visits to the last workspace", () => {
    const res = proxy(
      makeRequest("/", {
        auro_logged_in: "1",
        last_workspace_slug: "acme",
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.auro.test/acme/chat",
    );
  });

  it("forwards locale on login requests", () => {
    const res = proxy(makeRequest("/login", { "auro-locale": "zh-Hans" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(
      res.headers.get(`x-middleware-request-${AURO_LOCALE_HEADER}`),
    ).toBe("zh-Hans");
  });
});
