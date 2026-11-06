"use client";

import { useEffect } from "react";
import { setCurrentWorkspace } from "@auro/core/platform";
import { AdminPage } from "@auro/views/admin";
import "@auro/views/admin/admin.css";

export function AdminClient({ module = "games", worldId }: { module?: "games" | "mcp" | "worlds"; worldId?: string }) {
  useEffect(() => { setCurrentWorkspace(null,null); }, []);
  return <AdminPage module={module} worldId={worldId} />;
}
