import { z } from "zod";

const optionalString = z.preprocess(value => typeof value === "string" ? value : undefined, z.string().optional());

/** Small public-config contract; marketing does not import the application API client. */
export const AnalyticsPublicConfigSchema = z.object({
  posthog_key: optionalString,
  posthog_host: optionalString,
  analytics_environment: optionalString,
});
