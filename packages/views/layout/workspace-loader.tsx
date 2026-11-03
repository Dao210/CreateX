"use client";

import { AppLoading } from "../common/app-loading";
import { useT } from "../i18n";

/** Full-screen feedback while the authenticated world route resolves. */
export function WorkspaceLoader({ name }: { name?: string | null }) {
  const { t } = useT("layout");
  return (
    <AppLoading
      label={name
        ? t(($) => $.workspace_loader.loading_named, { name })
        : t(($) => $.workspace_loader.loading_workspace)}
    />
  );
}
