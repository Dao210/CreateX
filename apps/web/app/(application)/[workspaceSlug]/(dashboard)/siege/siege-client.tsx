"use client";
import "@auro/views/siege/siege.css";
import dynamic from "next/dynamic";
import { defaultStorage } from "@auro/core/platform";
const SiegePage = dynamic(() => import("@auro/views/siege").then(module => module.SiegePage), { ssr: false });
export function SiegeClient({ campaign = false }: { campaign?: boolean }) {
  return <SiegePage storage={defaultStorage} campaign={campaign} />;
}
