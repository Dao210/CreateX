"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@auro/ui/lib/utils";
import { useScrollFade } from "@auro/ui/hooks/use-scroll-fade";
import { AppLink, useNavigation } from "../navigation";
import { HelpLauncher } from "./help-launcher";
import { ChevronRight, LogOut } from "lucide-react";
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
  SidebarSeparator,
  useSidebar,
} from "@auro/ui/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@auro/ui/components/ui/alert-dialog";
import { useAuthStore } from "@auro/core/auth";
import { useWorldGames } from "@auro/core/admin";
import { AdminEntry } from "../admin/admin-entry";
import { useCurrentWorkspace, useWorkspacePaths } from "@auro/core/paths";
import { agentListOptions, myInvitationListOptions } from "@auro/core/workspace/queries";
import { resolvePublicFileUrl } from "@auro/core/workspace/avatar-url";
import { useQuery } from "@tanstack/react-query";
import { inboxUnreadSummaryOptions, useInboxUnreadCount, hasOtherWorkspaceUnread } from "@auro/core/inbox/queries";
import { useLogout } from "../auth";
import { routeIconForPath } from "./route-icon-components";
import { useT } from "../i18n";
import { ACCOUNT_SETTINGS_TABS, WORLD_SETTINGS_TABS, resolveSettingsLocation } from "../settings/components/settings-navigation";

// Keep an entry active on its child routes.
function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

const AGENT_PREVIEW_LIMIT = 5;
const EXPLORE_ENTRIES = ["tanks", "fish", "life", "siege"] as const;

const NAV_ITEM_CLASS_NAME =
  "text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground";
const GROUP_LABEL_CLASS_NAME =
  "h-6 group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:text-micro group-data-[collapsible=icon]:opacity-100";

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
  const { t: tCommon } = useT("common");
  const { pathname, searchParams } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const workspace = useCurrentWorkspace();
  const p = useWorkspacePaths();
  const worldHref = `${p.settings()}?tab=workspace`;
  const profileHref = `${p.settings()}?tab=profile`;
  const settingsTab = resolveSettingsLocation(searchParams).tab;
  const onSettingsPage = isNavActive(pathname, p.settings());
  const { data: myInvitations } = useQuery(myInvitationListOptions());

  // Dismiss the mobile sheet after navigation. Settings links also dismiss
  // it on click because switching settings tabs may only change the query.
  const { isCompact, setOpenMobile, state } = useSidebar();
  const isCollapsed = state === "collapsed" && !isCompact;
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const wsId = workspace?.id;
  const games = useWorldGames(wsId ?? "");
  const exploreEntries = EXPLORE_ENTRIES.filter(key =>
    games.data?.games.some(game => game.gameId === key && game.available && game.visible),
  );
  const unreadCount = useInboxUnreadCount(wsId);
  const { data: unreadSummary } = useQuery({
    ...inboxUnreadSummaryOptions(),
    enabled: !!wsId,
  });
  const worldAttention = (myInvitations?.length ?? 0) > 0 ||
    hasOtherWorkspaceUnread(unreadSummary ?? [], wsId);
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

  const worldName = workspace?.name ?? "Auro";
  const inboxLabel = t($ => $.nav.inbox);
  const creationsLabel = t($ => $.nav.me);
  const accountLabel = t($ => $.sidebar.account_settings_for, { name: user?.name ?? "" });
  const logoutLabel = t($ => $.sidebar.log_out);
  const InboxIcon = routeIconForPath(p.inbox());
  const CreationsIcon = routeIconForPath(p.me());
  const closeMobile = () => setOpenMobile(false);

  return (
      <Sidebar variant="inset" collapsible="icon">
        {topSlot}
        <SidebarHeader className={cn("py-3", headerClassName)} style={headerStyle}>
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={onSettingsPage && WORLD_SETTINGS_TABS.has(settingsTab)}
                render={<AppLink href={worldHref} />}
                onClick={closeMobile}
                aria-label={worldName}
                tooltip={worldName}
                className={NAV_ITEM_CLASS_NAME}
              >
                <span className="relative shrink-0">
                  <WorkspaceAvatar name={worldName} avatarUrl={workspace?.avatar_url} size="sm" />
                  {worldAttention && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-1 ring-sidebar" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:whitespace-nowrap">{worldName}</span>
                {!isCollapsed && <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isNavActive(pathname, p.inbox())}
                render={<AppLink href={p.inbox()} />}
                tooltip={inboxLabel}
                className={NAV_ITEM_CLASS_NAME}
              >
                <InboxIcon />
                <span>{inboxLabel}</span>
                {!isCollapsed && unreadCount > 0 && (
                  <CappedNumberFlow value={unreadCount} animated={false} className="ml-auto text-caption" />
                )}
              </SidebarMenuButton>
              {isCollapsed && unreadCount > 0 && (
                <span className="pointer-events-none absolute top-1.5 right-2 size-1.5 rounded-full bg-brand" />
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarSeparator />

        <SidebarContent ref={sidebarScrollRef} style={sidebarFadeStyle} className="group-data-[collapsible=icon]:overflow-y-auto">
          {exploreEntries.length > 0 && (
            <>
              <SidebarGroup role="group" aria-label={t($ => $.sidebar.explore_group)}>
                <SidebarGroupLabel className={GROUP_LABEL_CLASS_NAME}>{t($ => $.sidebar.explore_group)}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {exploreEntries.map(key => {
                      const href = p[key]();
                      const label = t($ => $.nav[key]);
                      const Icon = routeIconForPath(href);
                      return (
                        <SidebarMenuItem key={key}>
                          <SidebarMenuButton
                            isActive={isNavActive(pathname, href)}
                            render={<AppLink href={href} />}
                            tooltip={label}
                            className={NAV_ITEM_CLASS_NAME}
                          >
                            <Icon />
                            <span>{label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarSeparator />
            </>
          )}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isNavActive(pathname, p.me())}
                    render={<AppLink href={p.me()} />}
                    tooltip={creationsLabel}
                    className={NAV_ITEM_CLASS_NAME}
                  >
                    <CreationsIcon />
                    <span>{creationsLabel}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SidebarMenu className="gap-0.5">
            <AdminEntry />
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<AppLink href={profileHref} />}
                isActive={onSettingsPage && ACCOUNT_SETTINGS_TABS.has(settingsTab)}
                aria-label={accountLabel}
                tooltip={accountLabel}
                onClick={closeMobile}
                className={NAV_ITEM_CLASS_NAME}
              >
                <ActorAvatar
                  name={user?.name ?? ""}
                  initials={(user?.name ?? "U").charAt(0).toUpperCase()}
                  avatarUrl={resolvePublicFileUrl(user?.avatar_url)}
                  size="xs"
                />
                <span className="flex-1 truncate">{user?.name}</span>
                {!isCollapsed && <span className="shrink-0 text-caption">{t($ => $.sidebar.personal_account)}</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <HelpLauncher />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <AlertDialog>
                <AlertDialogTrigger render={<SidebarMenuButton tooltip={logoutLabel} className={NAV_ITEM_CLASS_NAME} />}>
                  <LogOut aria-hidden="true" />
                  <span>{logoutLabel}</span>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{logoutLabel}</AlertDialogTitle>
                    <AlertDialogDescription>{t($ => $.sidebar.logout_description)}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tCommon($ => $.cancel)}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={logout}>{logoutLabel}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
  );
}
