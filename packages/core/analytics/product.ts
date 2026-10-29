const publicRoutes = new Set(["", "about", "login", "signup", "onboarding", "join", "privacy", "terms", "licensing", "deal"]);
const workspaceRoutes = new Set(["tanks", "siege", "chat", "me", "settings", "agents", "skills", "runtimes", "inbox", "usage", "autopilots"]);

/** Keep route categories, never workspace slugs, object IDs, query strings or fragments. */
export function analyticsPath(pathname: string): string {
  const parts = pathname.split(/[?#]/, 1)[0]!.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (publicRoutes.has(parts[0]!)) return `/${parts[0]}`;
  if (parts[0] === "auth") return "/auth";
  if (parts[0] === "admin") return "/admin";
  if (parts[0] === "workspaces") return "/workspaces";
  const route = workspaceRoutes.has(parts[1] ?? "") ? parts[1] : "other";
  return `/workspace/${route}${route === "siege" && parts[2] === "campaign" ? "/campaign" : ""}`;
}

/** Also scrub SDK-provided URL properties and first-touch person properties. */
export function sanitizeAnalyticsProperties(properties: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(properties)) {
    if (["email", "name", "$title"].includes(key) || key.endsWith("_title") || key.endsWith("pathname")) {
      if (key.endsWith("pathname") && typeof value === "string") properties[key] = analyticsPath(value);
      else delete properties[key];
    } else if (key.endsWith("_url") && typeof value === "string") {
      try { const url = new URL(value); properties[key] = `${url.origin}${analyticsPath(url.pathname)}`; }
      catch { delete properties[key]; }
    } else if (key.includes("referrer") && typeof value === "string" && value !== "$direct") {
      try { properties[key] = new URL(value).origin; }
      catch { delete properties[key]; }
    } else if ((key === "$set" || key === "$set_once") && value && typeof value === "object" && !Array.isArray(value)) {
      sanitizeAnalyticsProperties(value as Record<string, unknown>);
    }
  }
}
