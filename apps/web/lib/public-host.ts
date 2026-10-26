const OFFICIAL_MARKETING_HOSTS = new Set(["weavea.world", "www.weavea.world", "auro.ai", "www.auro.ai"]);

export function isOfficialMarketingHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return OFFICIAL_MARKETING_HOSTS.has(normalized);
}
