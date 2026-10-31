"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleUser, Monitor, Moon, SearchIcon, Sun } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@auro/core/hooks";
import { useWorkspacePaths, WORKSPACE_PAGES, type WorkspacePageKey } from "@auro/core/paths";
import { memberListOptions } from "@auro/core/workspace/queries";
import { resolvePublicFileUrl } from "@auro/core/workspace/avatar-url";
import { createShortcutChord } from "@auro/core/shortcuts";
import { ActorAvatar } from "@auro/ui/components/common/actor-avatar";
import { useTheme } from "@auro/ui/components/common/theme-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@auro/ui/components/ui/dialog";
import { useIntentNavigate, resolveClickIntent, type LinkClickIntent } from "../navigation";
import { matchesPinyin } from "../editor/extensions/pinyin-match";
import { ShortcutKeycaps } from "../common/shortcut-keycaps";
import { routeIconForPath } from "../layout/route-icon-components";
import { useT } from "../i18n";
import { HighlightText } from "./highlight-text";
import { useSearchStore } from "./search-store";

const PAGE_KEYWORDS: Record<WorkspacePageKey, string[]> = {
  inbox: ["inbox", "notifications", "收件箱", "通知"],
  chat: ["chat", "messages", "conversation", "聊天", "消息", "对话"],
  autopilots: ["autopilot", "automation", "schedule", "cron", "自动化", "定时"],
  agents: ["agents", "bots", "ai", "智能体"],
  usage: ["usage", "analytics", "stats", "metrics", "统计", "分析", "用量"],
  runtimes: ["runtimes", "environments", "machines", "运行时"],
  skills: ["skills", "library", "技能"],
  siege: ["siege", "game", "workshop", "blueprint", "涂鸦", "攻城", "游戏"],
  tanks: ["tanks", "tank defense", "castle", "坦克", "守城", "戦車", "탱크", "chars"],
  life: ["life", "residents", "居民", "生活", "住民", "주민", "habitants"],
  me: ["me", "mine", "creations", "collection", "weapons", "progress", "我的", "作品", "收藏", "武器", "进度"],
  settings: ["world", "settings", "config", "世界", "设置", "配置"],
};
const PAGE_KEYS = Object.keys(WORKSPACE_PAGES) as WorkspacePageKey[];
const GROUP_CLASS = "p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";
const ROW_CLASS = "flex cursor-default select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-body outline-none data-selected:bg-accent";

function matchesRow(label: string, keywords: string[], query: string) {
  return label.toLowerCase().includes(query) || keywords.some((word) => word.startsWith(query)) || matchesPinyin(label, query);
}

export function SearchCommand() {
  const { t } = useT("search");
  const { t: tNav } = useT("layout");
  const open = useSearchStore((s) => s.open);
  const setOpen = useSearchStore((s) => s.setOpen);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigate = useIntentNavigate();
  const intent = useRef<LinkClickIntent>("push");
  const { theme, setTheme } = useTheme();
  // The launcher mounts this module on demand. Directory data is fetched only
  // after typing, and its existing workspace cache is reused across openings.
  const { data: members = [] } = useQuery({ ...memberListOptions(wsId), enabled: open && !!q });
  const pages = useMemo(() => [
    ...PAGE_KEYS.map((key) => ({
      key,
      label: key === "settings" ? tNav(($) => $.sidebar.world_settings) : tNav(($) => $.nav[WORKSPACE_PAGES[key].navKey]),
      href: key === "settings" ? `${paths.settings()}?tab=workspace` : paths[key](),
      keywords: PAGE_KEYWORDS[key],
    })),
    {
      key: "account", label: tNav(($) => $.sidebar.account_settings),
      href: `${paths.settings()}?tab=profile`,
      keywords: ["account", "profile", "preferences", "settings", "账号", "个人资料", "偏好", "设置"],
    },
  ], [paths, tNav]);
  const filteredPages = pages.filter((page) => !q || matchesRow(page.label, page.keywords, q));
  const wantsMembers = q.length >= 3 && ["members", "people", "users", "team"].some((word) => word.startsWith(q));
  const filteredMembers = q ? members.filter((member) => wantsMembers || matchesRow(member.name, [member.email, ...(q.length >= 3 ? [member.role] : [])], q)).slice(0, 10) : [];
  const commands = [
    { key: "light" as const, label: t(($) => $.commands.switch_to_light), icon: Sun, keywords: ["light", "theme", "appearance", "mode", "bright"] },
    { key: "dark" as const, label: t(($) => $.commands.switch_to_dark), icon: Moon, keywords: ["dark", "theme", "appearance", "mode", "night"] },
    { key: "system" as const, label: t(($) => $.commands.use_system_theme), icon: Monitor, keywords: ["system", "theme", "appearance", "mode", "auto"] },
  ].filter((command) => q && matchesRow(command.label, command.keywords, q));

  const openPath = (path: string) => {
    const disposition = intent.current;
    intent.current = "push";
    setOpen(false);
    navigate(path, disposition);
  };

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [open, setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[20%] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl!" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t(($) => $.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.description)}</DialogDescription>
        </DialogHeader>
        <CommandPrimitive shouldFilter={false} className="flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground"
          onClickCapture={(event) => { intent.current = resolveClickIntent(event); }}
          onKeyDownCapture={(event) => { if (event.key === "Enter") intent.current = resolveClickIntent({ button: 0, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey }); }}>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input placeholder={t(($) => $.placeholder)} value={query} onValueChange={setQuery}
              onKeyDown={(event) => { if (event.key === "Home" || event.key === "End") event.stopPropagation(); }}
              className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground" />
            <ShortcutKeycaps shortcut={createShortcutChord("Escape")} className="hidden shrink-0 sm:inline-flex" />
          </div>
          <CommandPrimitive.List className="max-h-[min(400px,50vh)] overflow-y-auto overflow-x-hidden">
            {filteredPages.length > 0 && <CommandPrimitive.Group heading={t(($) => $.groups.pages)} className={GROUP_CLASS}>
              {filteredPages.map((page) => {
                const Icon = page.key === "account" ? CircleUser : routeIconForPath(page.href);
                return <CommandPrimitive.Item key={page.key} value={`page:${page.key}`} onSelect={() => openPath(page.href)} className={ROW_CLASS}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" /><HighlightText text={page.label} query={query} />
                </CommandPrimitive.Item>;
              })}
            </CommandPrimitive.Group>}
            {commands.length > 0 && <CommandPrimitive.Group heading={t(($) => $.groups.commands)} className={GROUP_CLASS}>
              {commands.map((command) => <CommandPrimitive.Item key={command.key} value={`command:theme-${command.key}`} className={ROW_CLASS}
                onSelect={() => { setTheme(command.key); setOpen(false); }}>
                <command.icon className="size-4 shrink-0 text-muted-foreground" /><HighlightText text={command.label} query={query} />
                {theme === command.key && <Check aria-label={t(($) => $.commands.current_theme_aria)} className="ml-auto size-4" />}
              </CommandPrimitive.Item>)}
            </CommandPrimitive.Group>}
            {filteredMembers.length > 0 && <CommandPrimitive.Group heading={t(($) => $.groups.members)} className={GROUP_CLASS}>
              {filteredMembers.map((member) => <CommandPrimitive.Item key={member.user_id} value={`member:${member.user_id}`} onSelect={() => openPath(paths.memberDetail(member.user_id))} className={ROW_CLASS}>
                <ActorAvatar name={member.name} initials={member.name.split(" ").map((word) => word[0]).join("").slice(0, 2)} avatarUrl={resolvePublicFileUrl(member.avatar_url)} size="md" />
                <div className="min-w-0"><div className="truncate"><HighlightText text={member.name} query={query} /></div><div className="truncate text-caption text-muted-foreground"><HighlightText text={member.email} query={query} /></div></div>
              </CommandPrimitive.Item>)}
            </CommandPrimitive.Group>}
            {filteredPages.length === 0 && commands.length === 0 && filteredMembers.length === 0 && <CommandPrimitive.Empty className="py-10 text-center text-body text-muted-foreground">{t(($) => $.empty.no_results)}</CommandPrimitive.Empty>}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
