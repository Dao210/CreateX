// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  customRuntimeDocsHref,
  daemonRuntimesDocsHref,
} from "./runtime-docs";

describe("runtime docs links", () => {
  it.each([
    ["en", "https://auro.ai/docs/daemon-runtimes"],
    ["zh-Hans", "https://auro.ai/docs/zh/daemon-runtimes"],
    ["ja", "https://auro.ai/docs/ja/daemon-runtimes"],
    ["ko", "https://auro.ai/docs/ko/daemon-runtimes"],
    ["fr", "https://auro.ai/docs/fr/daemon-runtimes"],
  ])("localizes the daemon guide for %s", (language, expected) => {
    expect(daemonRuntimesDocsHref(language)).toBe(expected);
  });

  it("adds the localized custom runtime section", () => {
    expect(customRuntimeDocsHref("zh-Hans")).toBe(
      `https://auro.ai/docs/zh/daemon-runtimes#${encodeURIComponent("自定义运行时配置")}`,
    );
    expect(customRuntimeDocsHref("fr")).toBe(
      `https://auro.ai/docs/fr/daemon-runtimes#${encodeURIComponent("profils-de-runtime-personnalisés")}`,
    );
  });
});
