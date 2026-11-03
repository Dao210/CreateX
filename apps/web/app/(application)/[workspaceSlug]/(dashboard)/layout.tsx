"use client";

import { Suspense } from "react";
import { DashboardLayout } from "@auro/views/layout";
import { SearchCommand } from "@auro/views/search";
import { WebNotificationBridge } from "@/components/web-notification-bridge";
import { WorkspaceDocumentTitle } from "@/platform/workspace-document-title";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* useSearchParams requires a Suspense boundary in the app router. Sits
          outside DashboardLayout so the tab is named while the guard is still
          resolving the workspace. */}
      <Suspense fallback={null}>
        <WorkspaceDocumentTitle />
      </Suspense>
      <DashboardLayout
        extra={
          <>
            <SearchCommand />
            <WebNotificationBridge />
          </>
        }
      >
        {children}
      </DashboardLayout>
    </>
  );
}
