import { describe, expect, it } from "vitest";
import { workspaceUrlHost } from "./workspace-url";

describe("workspaceUrlHost", () => {
  it("returns the host of a full app URL", () => {
    expect(workspaceUrlHost("https://auro.example.com")).toBe(
      "auro.example.com",
    );
  });

  it("ignores scheme, path, and trailing slash", () => {
    expect(workspaceUrlHost("https://auro.example.com/")).toBe(
      "auro.example.com",
    );
    expect(workspaceUrlHost("http://auro.example.com/app/onboarding")).toBe(
      "auro.example.com",
    );
  });

  it("preserves a non-default port", () => {
    expect(workspaceUrlHost("https://my.host:3000")).toBe("my.host:3000");
  });

  it("accepts a bare host without a scheme", () => {
    expect(workspaceUrlHost("auro.example.com")).toBe("auro.example.com");
    expect(workspaceUrlHost("auro.example.com/path")).toBe(
      "auro.example.com",
    );
  });

  it("falls back to the brand host when no app URL is configured", () => {
    expect(workspaceUrlHost("")).toBe("auro.ai");
    expect(workspaceUrlHost("   ")).toBe("auro.ai");
    expect(workspaceUrlHost(null)).toBe("auro.ai");
    expect(workspaceUrlHost(undefined)).toBe("auro.ai");
  });
});
