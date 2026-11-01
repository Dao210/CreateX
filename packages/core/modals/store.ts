"use client";

import { create } from "zustand";

type ModalType = "feedback" | null;

interface ModalStore {
  modal: ModalType;
  data: Record<string, unknown> | null;
  autopilotQuotaRecoveryWorkspaceId: string | null;
  open: (modal: NonNullable<ModalType>, data?: Record<string, unknown> | null) => void;
  close: () => void;
  showAutopilotQuotaRecovery: (
    workspaceId: string,
  ) => void;
  dismissAutopilotQuotaRecovery: () => void;
}

export const useModalStore = create<ModalStore>((set) => ({
  modal: null,
  data: null,
  autopilotQuotaRecoveryWorkspaceId: null,
  open: (modal, data = null) => set({ modal, data }),
  close: () => set({ modal: null, data: null }),
  showAutopilotQuotaRecovery: (workspaceId) =>
    set({
      autopilotQuotaRecoveryWorkspaceId: workspaceId,
    }),
  dismissAutopilotQuotaRecovery: () =>
    set({
      autopilotQuotaRecoveryWorkspaceId: null,
        }),
}));
