"use client";

import "@auro/views/siege/siege.css";

import { use } from "react";
import dynamic from "next/dynamic";
import { createWebSiegePlatform } from "@auro/views/siege/platform/web";
import { SiegeLoading } from "./siege-loading";

// Rapier compiles WebAssembly at module init and the workshop reads a canvas,
// so nothing here may run during server rendering.
const SiegeWorkshop = dynamic(() => import("@auro/views/siege").then(m => m.SiegeWorkshop), {
  ssr: false,
  loading: () => <SiegeLoading />,
});

// One platform instance per tab: it holds the preference adapter and draft
// store, which are stateless wrappers, so sharing is safe.
const platform = createWebSiegePlatform();

export default function SiegePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = use(params);
  return <SiegeWorkshop platform={platform} campaignHref={`/${workspaceSlug}/siege/campaign`} />;
}
