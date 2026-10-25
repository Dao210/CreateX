"use client";

import { use } from "react";
import dynamic from "next/dynamic";
import { createWebSiegePlatform } from "@auro/views/siege/platform/web";
import { SiegeLoading } from "../siege-loading";

const CampaignApp = dynamic(() => import("@auro/views/siege").then(m => m.CampaignApp), {
  ssr: false,
  loading: () => <SiegeLoading />,
});

const platform = createWebSiegePlatform();

export default function SiegeCampaignPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = use(params);
  return <CampaignApp platform={platform} workshopHref={`/${workspaceSlug}/siege`} />;
}
