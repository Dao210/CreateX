export {
  ApiClient,
  ApiError,
  clientErrorMessage,
  dispatchReasonCode,
  errorCode,
  PreviewTooLargeError,
  PreviewUnsupportedError,
} from "./client";
export type {
  ApiClientOptions,
  ClientRuntimeSnapshot,
  ClientUsageRequest,
} from "./client";
export { parseWithFallback, setSchemaLogger } from "./schema";
export type { ParseOptions } from "./schema";
export { DuplicateIssueErrorBodySchema } from "./schemas";
export type { DuplicateIssueErrorBody } from "./schemas";
export { WSClient } from "./ws-client";

import type { ApiClient as ApiClientType } from "./client";

/** Module-level singleton — set once at app boot via `setApiInstance()`. */
let _api: ApiClientType | null = null;

export function setApiInstance(instance: ApiClientType) {
  _api = instance;
}

/** Returns the shared ApiClient singleton. Throws if not yet initialised. */
export function getApi(): ApiClientType {
  if (!_api) throw new Error("ApiClient not initialised — call setApiInstance() first");
  return _api;
}

/**
 * Convenience re-export: a proxy that forwards every property access to the
 * singleton so existing call-sites (`api.listIssues(...)`) keep working.
 */
export const api = new Proxy({} as ApiClientType, {
  get(_target, prop, receiver) {
    // Allow property inspection (HMR/React Refresh) before initialisation
    if (!_api) return undefined;
    const value = Reflect.get(_api, prop, receiver);
    return typeof value === "function" ? value.bind(_api) : value;
  },
});

/**
 * `fetch` that carries the headers the shared client would attach to its own
 * requests: `X-Workspace-Slug`, the CSRF token, the bearer credential and the
 * client identity.
 *
 * Features that live outside ApiClient but still speak to the same API must not
 * re-derive those headers. The workspace slug is URL-owned state and the CSRF
 * binding rotates on renewal, so a second implementation goes stale in ways
 * that stay invisible until a write is rejected. Before a client exists (the
 * standalone siege shell, which runs without Auro's auth) this degrades to a
 * plain credentialed fetch.
 *
 * A path starting with "/" is resolved against the client's base URL: the
 * desktop renderer runs from file://, where a relative URL never reaches the
 * API.
 */
export function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(_api ? _api.authHeaders() : {}),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  const target =
    typeof input === "string" && input.startsWith("/") && _api
      ? `${_api.getBaseUrl()}${input}`
      : input;
  return fetch(target, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
}

