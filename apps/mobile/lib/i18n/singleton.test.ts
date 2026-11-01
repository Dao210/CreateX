// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "./singleton";

describe("mobile i18n singleton", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("loads the English and Simplified Chinese bundles", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("actions.cancel")).toBe("Cancel");
    expect(i18n.t("common:actions.cancel")).toBe("Cancel");
    expect(i18n.t("navigation:tabs.inbox")).toBe("Inbox");

    await i18n.changeLanguage("zh-Hans");
    expect(i18n.t("actions.cancel")).toBe("取消");
    expect(i18n.t("common:actions.cancel")).toBe("取消");
    expect(i18n.t("navigation:tabs.inbox")).toBe("收件箱");
  });

  it("formats counts with interpolation", async () => {
    await i18n.changeLanguage("zh-Hans");
    expect(i18n.t("execution:list.count_other", { count: 3 })).toBe(
      "3 个任务",
    );
  });
});
