// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapAuthError } from "./auth-error";

describe("auth error copy", () => {
  it("distinguishes password rejection from a mismatched verification code", () => {
    const t = (key: string) => key;
    expect(mapAuthError(new Error("invalid email or password"), "fallback", t)).toBe("errors.credentials_invalid");
    expect(mapAuthError(new Error("invalid or expired code"), "fallback", t)).toBe("verify.mismatch");
    expect(mapAuthError(new Error("password must contain at least 8 characters and at most 72 bytes"), "fallback", t)).toBe("errors.password_length");
  });
});
