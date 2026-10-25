"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { adminAccessOptions } from "@auro/core/admin";
import { paths } from "@auro/core/paths";
import { SidebarMenuItem, SidebarMenuButton } from "@auro/ui/components/ui/sidebar";
import { AppLink } from "../navigation";
import { useT } from "../i18n";

export function AdminEntry() {
  const {t} = useT("admin");
  const userId = useAuthStore(state => state.user?.id ?? "");
  const access = useQuery(adminAccessOptions(userId));
  if (!access.data?.isAdmin) return null;
  return <SidebarMenuItem><SidebarMenuButton render={<AppLink href={paths.admin()} />}><ShieldCheck /><span>{t($ => $.entry)}</span></SidebarMenuButton></SidebarMenuItem>;
}
