"use client";

import { ArrowUpRight, CircleHelp, MessageCircle } from "lucide-react";
import { SidebarMenuButton } from "@auro/ui/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@auro/ui/components/ui/dropdown-menu";
import { useModalStore } from "@auro/core/modals";
import { DISCORD_URL, DiscordIcon } from "./discord";
import { useT } from "../i18n";

export function HelpLauncher() {
  const { t } = useT("layout");
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
