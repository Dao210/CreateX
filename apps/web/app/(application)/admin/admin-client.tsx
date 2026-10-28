"use client";

import { useEffect } from "react";
import { setCurrentWorkspace } from "@auro/core/platform";
import { AdminPage } from "@auro/views/admin";
import "@auro/views/admin/admin.css";

export function AdminClient() {
  useEffect(() => { setCurrentWorkspace(null,null); }, []);
  return <AdminPage />;
}
