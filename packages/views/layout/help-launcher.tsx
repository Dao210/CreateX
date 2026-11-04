"use client";

import { ArrowUpRight, CircleHelp, MessageCircle } from "lucide-react";
import { SidebarMenuButton } from "@auro/ui/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@auro/ui/components/ui/dropdown-menu";
import { useModalStore } from "@auro/core/modals";
import { useConfigStore } from "@auro/core/config";
import { DISCORD_URL, DiscordIcon } from "./discord";
import { useT } from "../i18n";

export function HelpLauncher() {
  const { t } = useT("layout");
  const serverVersion = useConfigStore((state) => state.serverVersion);
  const label = t($ => $.help.trigger);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton tooltip={label} className="text-muted-foreground data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}
      >
        <CircleHelp aria-hidden="true" />
        <span>{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="min-w-40 max-w-56"
      >
        <DropdownMenuItem
          render={
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <DiscordIcon className="h-3.5 w-3.5" />
          {t(($) => $.help.discord)}
          <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => useModalStore.getState().open("feedback")}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {t(($) => $.help.feedback)}
        </DropdownMenuItem>
        {serverVersion && (
          <>
            <DropdownMenuSeparator />
            {/* DropdownMenuLabel renders Base UI's Menu.GroupLabel, which reads
                a Menu.Group context and throws if it has no Group ancestor. It
                must always be wrapped in a DropdownMenuGroup — without it the
                Help menu crashes the whole app on open (no error boundary sits
                above the sidebar). */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal break-words">
                {t(($) => $.help.server_version, { version: serverVersion })}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
