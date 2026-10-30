"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@auro/ui/lib/utils";
import { useScrollFade } from "@auro/ui/hooks/use-scroll-fade";
import { AppLink, useNavigation } from "../navigation";
import { HelpLauncher } from "./help-launcher";
import { JoinDiscordCard } from "./join-discord-card";
import {
  ChevronDown,
  LogOut,
  Check,
} from "lucide-react";
import { WorkspaceAvatar } from "../workspace/workspace-avatar";
import { ActorAvatar } from "@auro/ui/components/common/actor-avatar";
import { CappedNumberFlow } from "@auro/ui/components/ui/number-flow";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@auro/ui/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@auro/ui/components/ui/dropdown-menu";
import { useAuthStore } from "@auro/core/auth";
import { AdminEntry } from "../admin/admin-entry";
import { useCurrentWorkspace, useWorkspacePaths, paths } from "@auro/core/paths";
import {
  agentListOptions,
  workspaceListOptions,
  myInvitationListOptions,
  workspaceKeys,
} from "@auro/core/workspace/queries";
import { resolvePublicFileUrl } from "@auro/core/workspace/avatar-url";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { inboxUnreadSummaryOptions, useInboxUnreadCount, hasOtherWorkspaceUnread, unreadWorkspaceIds } from "@auro/core/inbox/queries";
import { api } from "@auro/core/api";
import { useLogout } from "../auth";
import { routeIconForPath } from "./route-icon-components";
import { useT } from "../i18n";
import { ACCOUNT_SETTINGS_TABS, WORLD_SETTINGS_TABS, resolveSettingsLocation } from "../settings/components/settings-navigation";

// Top-level nav items stay active when the user is on a child route
// (e.g. "Projects" stays lit on /:slug/projects/:id). Pinned items keep
// strict equality elsewhere — a pinned project shouldn't highlight on
// sub-pages of itself.
function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// Stable empty arrays for query defaults. Using an inline `= []` default on
// `useQuery` creates a new array reference on every render when `data` is
// undefined (e.g. query disabled or loading) — which in turn breaks any
// `useEffect`/`useMemo` that depends on the value, and can trigger infinite
// re-render loops when the effect itself calls `setState`.
const EMPTY_WORKSPACES: Awaited<ReturnType<typeof api.listWorkspaces>> = [];
const EMPTY_INVITATIONS: Awaited<ReturnType<typeof api.listMyInvitations>> = [];
const EMPTY_INBOX_SUMMARY: Awaited<ReturnType<typeof api.getInboxUnreadSummary>> = [];
const AGENT_PREVIEW_LIMIT = 5;

// Nav items reference WorkspacePaths method names so they can be resolved
// against the current workspace slug at render time (see AppSidebar body).
// Only parameterless paths are valid nav destinations.
type NavKey =
  | "inbox"
  | "usage"
  | "siege"
  | "tanks"
  | "me"
  | "settings";

// Static schema (key only) — labels resolved at render via useT("layout"),
// icons derived from the destination path via routeIconForPath.
type NavLabelKey =
  | "inbox"
  | "usage"
  | "siege"
  | "tanks"
  | "me"
  | "settings";

// Nav icons are NOT declared here: they are derived from each item's
// destination path at render time, so the sidebar and the desktop tab bar
// always agree. See route-icon-components.tsx.
// The collection is the workspace home; both games remain one click away.
const personalNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "me", labelKey: "me" },
  { key: "tanks", labelKey: "tanks" },
  { key: "siege", labelKey: "siege" },
  { key: "inbox", labelKey: "inbox" },
];

const utilityNav: { key: NavKey; labelKey: NavLabelKey }[] = [
  { key: "usage", labelKey: "usage" },
  { key: "settings", labelKey: "settings" },
];

const NAV_ITEM_CLASS_NAME =
  "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground";

interface AppSidebarProps {
  /** Rendered above SidebarHeader (e.g. desktop traffic light spacer) */
  topSlot?: React.ReactNode;
  /** Extra className for SidebarHeader */
  headerClassName?: string;
  /** Extra style for SidebarHeader */
  headerStyle?: React.CSSProperties;
}

export function AppSidebar({ topSlot, headerClassName, headerStyle }: AppSidebarProps = {}) {
  const { t } = useT("layout");
  const { pathname, searchParams, push } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();
  const profileHref = `${p.settings()}?tab=profile`;
  const settingsTab = resolveSettingsLocation(searchParams).tab;
  const onSettingsPage = isNavActive(pathname, p.settings());
  const { data: workspaces = EMPTY_WORKSPACES } = useQuery(workspaceListOptions());
  const { data: myInvitations = EMPTY_INVITATIONS } = useQuery(myInvitationListOptions());

  // On a phone the sidebar is a Sheet covering the page, so navigating out of
  // it has to dismiss it — otherwise the destination renders underneath and the
  // tap reads as "nothing happened". Closing on `pathname` rather than on each
  // link's onClick covers every route out of here at once: the nav groups, the
  // pinned items, the workspace switcher's programmatic push, and anything
  // added later. `setOpenMobile` is a no-op on desktop, where the sheet is not
  // the sidebar's rendering at all.
  const { setOpenMobile, state } = useSidebar();
  const isCollapsed = state === "collapsed";
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const wsId = workspace?.id;
  // Nav badge. Reads the cross-workspace unread summary fetched just below
  // for the switcher dot, so the count costs no request of its own — it used
  // to download the whole inbox list here just to count it (MUL-6967).
  const unreadCount = useInboxUnreadCount(wsId);
  // Cross-workspace unread summary backs the workspace-switcher dot. One
  // shared cache entry across workspaces; gated on an active workspace since
  // the endpoint resolves through the workspace-member middleware.
  const { data: unreadSummary = EMPTY_INBOX_SUMMARY } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!wsId,
  });
  const otherWorkspaceUnread = React.useMemo(
    () => hasOtherWorkspaceUnread(unreadSummary, wsId),
    [unreadSummary, wsId],
  );
  // Which workspaces have unread, so the switcher dropdown can point at the
  // specific one(s) rather than just the aggregate avatar dot.
  const unreadWsIds = React.useMemo(() => unreadWorkspaceIds(unreadSummary), [unreadSummary]);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarFadeStyle = useScrollFade(sidebarScrollRef, 24);

  // Created agents are shortcuts in the top nav group; archived agents keep
  // their history but drop out of navigation.
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId ?? ""),
    enabled: !!wsId,
  });
  const activeAgents = React.useMemo(
    () => agents.filter((agent) => !agent.archived_at),
    [agents],
  );
  const [expandedAgentsWorkspaceId, setExpandedAgentsWorkspaceId] = useState<string | null>(null);
  const agentsExpanded = expandedAgentsWorkspaceId === wsId;
  const displayedAgents =
    agentsExpanded || isCollapsed ? activeAgents : activeAgents.slice(0, AGENT_PREVIEW_LIMIT);

  const queryClient = useQueryClient();
  const acceptInvitationMut = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    // After accepting an invitation, navigate INTO the newly-joined workspace.
    // Otherwise the user stays on their current workspace and just sees the
    // new one appear in the dropdown — silent and confusing (this is MUL-820).
    onSuccess: async (_, invitationId) => {
      const invitation = myInvitations.find((i) => i.id === invitationId);
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      // staleTime: 0 forces a real network fetch — we need the joined workspace
      // in the list before we can resolve its slug for navigation.
      const list = await queryClient.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = invitation
        ? list.find((w) => w.id === invitation.workspace_id)
        : null;
      if (joined) {
        push(paths.workspace(joined.slug).root());
      }
    },
    onError: () => {
      // "invitation is not pending" means the invite was concluded from
      // another surface while this row was on screen. Refetch so the stale
      // row drops instead of sticking around until restart — a silent
      // failure here reads as "the button does nothing".
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });
  const declineInvitationMut = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    // Either outcome must refresh the list: success drops the declined row,
    // and a failure ("invitation is not pending") means the invite was
    // concluded from another surface — refetch drops the stale row.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    },
  });

  return (
      <Sidebar variant="inset" collapsible="icon">
        {topSlot}
        {/* Workspace Switcher */}
        <SidebarHeader className={cn("py-3", headerClassName)} style={headerStyle}>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton>
                      <span className="relative">
                        <WorkspaceAvatar name={workspace?.name ?? "M"} avatarUrl={workspace?.avatar_url} size="sm" />
                        {/* Shared brand dot: a pending invitation OR another
                            workspace with unread inbox items. The active
                            workspace's own unread stays on the Inbox nav count
                            (below), so it is deliberately excluded here. */}
                        {(myInvitations.length > 0 || otherWorkspaceUnread) && (
                          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-1 ring-sidebar" />
                        )}
                      </span>
                      {isCollapsed ? null : (
                        <>
                          <span className="flex-1 truncate font-medium" title={workspace?.name}>
                            {workspace?.name ?? "Auro"}
                          </span>
                          <ChevronDown className="size-3 text-muted-foreground" />
                        </>
                      )}
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent
                  className="w-auto min-w-56"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <ActorAvatar
                      name={user?.name ?? ""}
                      initials={(user?.name ?? "U").charAt(0).toUpperCase()}
                      avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium leading-tight">
                        {user?.name}
                      </p>
                      <p className="truncate text-caption text-muted-foreground leading-tight">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-caption text-muted-foreground">
                      {t(($) => $.sidebar.workspaces_label)}
                    </DropdownMenuLabel>
                    {workspaces.map((ws) => (
                      <DropdownMenuItem
                        key={ws.id}
                        render={
                          <AppLink href={paths.workspace(ws.slug).root()} />
                        }
                      >
                        <WorkspaceAvatar name={ws.name} avatarUrl={ws.avatar_url} size="sm" />
                        <span className="flex-1 truncate" title={ws.name}>{ws.name}</span>
                        {/* Points at the specific workspace holding unread
                            inbox items. Sits in the same right-edge slot as the
                            active-workspace check; the active workspace is
                            excluded (its unread is the Inbox nav count), so dot
                            and check never collide on one row. */}
                        {ws.id !== workspace?.id && unreadWsIds.has(ws.id) && (
                          <span className="size-2 rounded-full bg-brand" />
                        )}
                        {ws.id === workspace?.id && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  {myInvitations.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-caption text-muted-foreground">
                          {t(($) => $.sidebar.pending_invitations_label)}
                        </DropdownMenuLabel>
                        {myInvitations.map((inv) => (
                          <div key={inv.id} className="flex items-center gap-2 px-2 py-1.5">
                            <WorkspaceAvatar name={inv.workspace_name ?? "W"} size="sm" />
                            <span className="flex-1 truncate text-body">{inv.workspace_name ?? t(($) => $.sidebar.invitation_workspace_fallback)}</span>
                            <button
                              type="button"
                              className="text-caption px-2 py-0.5 rounded-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              disabled={acceptInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                acceptInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_join)}
                            </button>
                            <button
                              type="button"
                              className="text-caption px-2 py-0.5 rounded-xs bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                              disabled={declineInvitationMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                declineInvitationMut.mutate(inv.id);
                              }}
                            >
                              {t(($) => $.sidebar.invitation_decline)}
                            </button>
                          </div>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onClick={logout}>
                      <LogOut className="h-3.5 w-3.5" />
                      {t(($) => $.sidebar.log_out)}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {personalNav.map((item) => {
                  const href = p[item.key]();
                  const Icon = routeIconForPath(href);
                  const isActive = isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className={NAV_ITEM_CLASS_NAME}
                      >
                        <Icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                        {!isCollapsed && item.key === "inbox" && unreadCount > 0 && (
                          <CappedNumberFlow
                            value={unreadCount}
                            animated={false}
                            className="ml-auto text-caption"
                          />
                        )}
                      </SidebarMenuButton>
                      {isCollapsed && item.key === "inbox" && unreadCount > 0 && (
                        <span className="pointer-events-none absolute top-1.5 right-2 size-1.5 rounded-full bg-brand" />
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
              {activeAgents.length > 0 && (
                <>
                  {!isCollapsed && (
                    <SidebarGroupLabel className="mt-1">
                      {t(($) => $.sidebar.my_assistants_group)}
                    </SidebarGroupLabel>
                  )}
                  <SidebarMenu className="gap-0.5">
                    {displayedAgents.map((agent) => {
                      const href = p.chatWithAgent(agent.id);
                      return (
                        <SidebarMenuItem key={agent.id}>
                          <SidebarMenuButton
                            render={<AppLink href={href} />}
                            className={NAV_ITEM_CLASS_NAME}
                          >
                            <ActorAvatar
                              name={agent.name}
                              initials={agent.name.charAt(0).toUpperCase()}
                              avatarUrl={resolvePublicFileUrl(agent.avatar_url)}
                              isAgent
                              size="xs"
                            />
                            <span>{agent.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                    {!isCollapsed && activeAgents.length > AGENT_PREVIEW_LIMIT && (
                      <SidebarMenuButton
                        size="sm"
                        aria-expanded={agentsExpanded}
                        className="mt-0.5 pl-7 text-muted-foreground"
                        onClick={() =>
                          setExpandedAgentsWorkspaceId(agentsExpanded ? null : wsId ?? null)
                        }
                      >
                        <span>
                          {agentsExpanded
                            ? t(($) => $.sidebar.show_fewer_pins)
                            : t(($) => $.sidebar.show_more_pins, {
                                count: activeAgents.length - AGENT_PREVIEW_LIMIT,
                              })}
                        </span>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenu>
                </>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2">
          <SidebarMenu className="gap-0.5">
            <AdminEntry />
            {utilityNav.map((item) => {
              const href = item.key === "settings" ? `${p.settings()}?tab=workspace` : p[item.key]();
              const Icon = routeIconForPath(href);
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={item.key === "settings" ? onSettingsPage && WORLD_SETTINGS_TABS.has(settingsTab) : isNavActive(pathname, href)}
                    render={<AppLink href={href} />}
                    onClick={() => setOpenMobile(false)}
                    className={NAV_ITEM_CLASS_NAME}
                  >
                    <Icon />
                    <span>{item.key === "settings" ? t(($) => $.sidebar.world_settings) : t(($) => $.nav[item.labelKey])}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
          {/* Help trails the profile row when expanded. The collapsed rail is
              too narrow for both, so there it keeps a centered row of its own. */}
          {isCollapsed ? (
            <div className="flex items-center justify-center">
              <HelpLauncher />
            </div>
          ) : (
            <JoinDiscordCard />
          )}
          <div className="flex items-center gap-1">
            <SidebarMenu className="min-w-0 flex-1 gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<AppLink href={profileHref} />}
                  isActive={onSettingsPage && ACCOUNT_SETTINGS_TABS.has(settingsTab)}
                  aria-label={t(($) => $.sidebar.account_settings_for, { name: user?.name ?? "" })}
                  // The profile link only changes the settings tab, so the
                  // pathname-driven sheet dismissal above cannot see it.
                  onClick={() => setOpenMobile(false)}
                  className={NAV_ITEM_CLASS_NAME}
                >
                  <ActorAvatar
                    name={user?.name ?? ""}
                    initials={(user?.name ?? "U").charAt(0).toUpperCase()}
                    avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
                    size="xs"
                  />
                  <span className="flex-1 truncate">{user?.name}</span>
                  {!isCollapsed && <span className="shrink-0 text-caption">{t(($) => $.sidebar.account_settings)}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            {isCollapsed ? null : <HelpLauncher />}
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
  );
}
