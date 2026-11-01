"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { SurfaceLoading } from "../common/surface-loading";
import { useModalStore } from "@auro/core/modals";
const FeedbackModal = lazy(() => import("./feedback").then((module) => ({ default: module.FeedbackModal })));
const AutopilotQuotaDialog = lazy(() => import("./autopilot-quota-dialog").then((module) => ({ default: module.AutopilotQuotaDialog })));

export function ModalRegistry() {
  const modal = useModalStore((s) => s.modal);
  const data = useModalStore((s) => s.data);
  const close = useModalStore((s) => s.close);

  const recoveryWorkspaceId = useModalStore((s) => s.autopilotQuotaRecoveryWorkspaceId);

  let activeModal: ReactNode = null;
  switch (modal) {
    case "feedback":
      activeModal = <FeedbackModal onClose={close} data={data} />;
      break;
  }

  return (
    <Suspense fallback={<SurfaceLoading />}>
      {activeModal}
      {recoveryWorkspaceId != null && <AutopilotQuotaDialog />}
    </Suspense>
  );
}
