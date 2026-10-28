import type { Metadata } from "next";

export function searchVerification(env: Readonly<Record<string, string | undefined>>): Metadata["verification"] {
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = env.BING_SITE_VERIFICATION?.trim();
  const baidu = env.BAIDU_SITE_VERIFICATION?.trim();
  return {
    ...(google ? { google } : {}),
    other: {
      ...(bing ? { "msvalidate.01": bing } : {}),
      ...(baidu ? { "baidu-site-verification": baidu } : {}),
    },
  };
}
