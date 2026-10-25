// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createLogger, setLogLevel } from "./logger";

afterEach(() => { setLogLevel("warn"); vi.restoreAllMocks(); });
it("skips console work until diagnostics are enabled, including for existing loggers", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const logger = createLogger("test");
  logger.debug("typing"); logger.info("request"); logger.warn("failed");
  expect(log).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalledOnce();
  setLogLevel("debug"); logger.debug("diagnostic");
  expect(log).toHaveBeenCalledOnce();
});
