"use client";

import { useT } from "../../i18n";
import { LabelManager } from "../../labels/label-manager";
import { SettingsTab } from "./settings-layout";

export function LabelsTab() {
  const { t } = useT("settings");
  return <SettingsTab title={t(($) => $.labels.title)} scope="workspace">
    <LabelManager scope="skill" />
  </SettingsTab>;
}
