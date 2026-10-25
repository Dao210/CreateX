"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { SurfaceLoading } from "../common/surface-loading";
import { useModalStore } from "@auro/core/modals";
const CreateSquadModal = lazy(() => import("./create-squad").then((module) => ({ default: module.CreateSquadModal })));
const FeedbackModal = lazy(() => import("./feedback").then((module) => ({ default: module.FeedbackModal })));
const IssueLimitUpgradeDialog = lazy(() => import("./issue-limit-upgrade-dialog").then((module) => ({ default: module.IssueLimitUpgradeDialog })));

export function ModalRegistry() {
  const modal = useModalStore((s) => s.modal);
  const data = useModalStore((s) => s.data);
  const close = useModalStore((s) => s.close);

  const recoveryWorkspaceId = useModalStore((s) => s.issueLimitRecoveryWorkspaceId);

  let activeModal: ReactNode = null;
  switch (modal) {
    case "create-squad":
      activeModal = <CreateSquadModal onClose={close} />;
      break;
    case "feedback":
      activeModal = <FeedbackModal onClose={close} data={data} />;
      break;
  }

  return (
    <Suspense fallback={<SurfaceLoading />}>
      {activeModal}
      {recoveryWorkspaceId != null && <IssueLimitUpgradeDialog />}
    </Suspense>
  );
}
