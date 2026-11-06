import { useEffect, useRef } from "react";
import { getApi } from "../api";

const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short" });

export function useWorldVisit(workspaceId: string | undefined, userId: string | undefined) {
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    let pending = false;
    const report = () => {
      if (pending || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const key = `${userId}/${workspaceId}/${dayFormat.format(new Date())}`;
      if (reported.current === key) return;
      pending = true;
      void getApi().recordWorldVisit(workspaceId).then(() => {
        reported.current = key;
      }).catch(() => {
        // A later focus can retry without blocking world navigation.
      }).finally(() => { pending = false; });
    };
    report();
    window.addEventListener("focus", report);
    document.addEventListener("visibilitychange", report);
    return () => {
      window.removeEventListener("focus", report);
      document.removeEventListener("visibilitychange", report);
    };
  }, [workspaceId, userId]);
}
