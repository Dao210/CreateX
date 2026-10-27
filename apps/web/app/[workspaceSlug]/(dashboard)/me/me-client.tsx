"use client";

import dynamic from "next/dynamic";
import { defaultStorage } from "@auro/core/platform";

const MePage = dynamic(() => import("@auro/views/me").then((module) => module.MePage), { ssr: false });

export function MeClient() {
  return <MePage storage={defaultStorage} />;
}
