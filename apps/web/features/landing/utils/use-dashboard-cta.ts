"use client";

import { useAuthStore } from "@auro/core/auth";
import { useWorkspaceList } from "@auro/core/workspace";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@auro/core/paths";
import type { Workspace } from "@auro/core/types";

/** The login entry resolves the authenticated visitor’s workspace destination. */
const LOADING_FALLBACK_HREF = "/login";

export function resolveDashboardCtaHref({
  isAuthenticated,
  workspaceListReady,
  workspaces,
  hasOnboarded,
}: {
  isAuthenticated: boolean;
  workspaceListReady: boolean;
  workspaces: Workspace[];
  hasOnboarded: boolean;
}): string {
  if (!isAuthenticated) return paths.login();
  if (!workspaceListReady) return LOADING_FALLBACK_HREF;
  return resolvePostAuthDestination(workspaces, hasOnboarded);
}

/**
 * Destination for the landing "Dashboard" CTA.
 *
 * These CTAs used to point at `/` and lean on the proxy bouncing logged-in
 * visitors from the root path to their workspace. Once `/` stayed public on the
 * official marketing host, that bounce stopped and the CTA resolved to the page
 * the visitor was already on — a click with no visible effect. Resolve the real
 * destination here instead, through the same resolver
 * `RedirectIfAuthenticated` uses, so "where the dashboard lives" has one source
 * of truth.
 *
 * Shares `workspaceListOptions()`' query key with `RedirectIfAuthenticated`, so
 * on the landing page the list is typically already in flight or cached and this
 * adds no request.
 */
export function useDashboardCtaHref(): string {
  const user = useAuthStore((s) => s.user);
  const hasOnboarded = useHasOnboarded();

  const { workspaces, ready } = useWorkspaceList({ enabled: !!user });

  return resolveDashboardCtaHref({
    isAuthenticated: !!user,
    workspaceListReady: ready,
    workspaces,
    hasOnboarded,
  });
}
