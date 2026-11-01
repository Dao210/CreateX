import { describe, expect, it } from "vitest";

import {
  dashboardAgentRunTimeOptions,
  dashboardFailuresByAgentOptions,
  dashboardFailuresDailyOptions,
  dashboardRunTimeDailyOptions,
  dashboardUsageByAgentOptions,
  dashboardUsageDailyOptions,
} from "./queries";

type QueryOptionsWithPlaceholder = {
  queryKey: readonly unknown[];
  placeholderData?: unknown;
};

function resolvePlaceholder(
  options: QueryOptionsWithPlaceholder,
  previousData: unknown,
  previousKey: readonly unknown[] | undefined,
) {
  expect(options.placeholderData).toBeTypeOf("function");
  return (
    options.placeholderData as (
      data: unknown,
      query: { queryKey: readonly unknown[] } | undefined,
    ) => unknown
  )(
    previousData,
    previousKey ? { queryKey: previousKey } : undefined,
  );
}

const optionBuilders = [
  dashboardUsageDailyOptions,
  dashboardUsageByAgentOptions,
  dashboardAgentRunTimeOptions,
  dashboardRunTimeDailyOptions,
  dashboardFailuresDailyOptions,
  dashboardFailuresByAgentOptions,
] as const;

describe("dashboard range placeholders", () => {
  it.each(optionBuilders)(
    "keeps the previous %s result when only the day range changes",
    (buildOptions) => {
      const previous = [{ sentinel: "30d" }];
      const previousOptions = buildOptions("ws-1", 30, "UTC");
      const nextOptions = buildOptions("ws-1", 7, "UTC");

      expect(
        resolvePlaceholder(nextOptions, previous, previousOptions.queryKey),
      ).toBe(previous);
    },
  );

  it("does not carry placeholder data across workspace or timezone scopes", () => {
    const previous = [{ sentinel: "previous-scope" }];
    const nextOptions = dashboardUsageDailyOptions(
      "ws-1",
      7,
      "Asia/Shanghai",
    );
    const previousScopes = [
      dashboardUsageDailyOptions(
        "ws-2",
        30,
          "Asia/Shanghai",
      ),
      dashboardUsageDailyOptions("ws-1", 30, "UTC"),
    ];

    for (const previousOptions of previousScopes) {
      expect(
        resolvePlaceholder(nextOptions, previous, previousOptions.queryKey),
      ).toBeUndefined();
    }
  });

  it("keeps the initial loading state honest when there is no previous query", () => {
    const options = dashboardUsageDailyOptions("ws-1", 30, "UTC");

    expect(resolvePlaceholder(options, undefined, undefined)).toBeUndefined();
  });
});
