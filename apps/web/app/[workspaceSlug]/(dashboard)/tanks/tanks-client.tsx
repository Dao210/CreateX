"use client";

import "@auro/views/tank-defense/tank-defense.css";
import dynamic from "next/dynamic";
import { defaultStorage } from "@auro/core/platform";

const TankDefensePage = dynamic(() => import("@auro/views/tank-defense").then(module => module.TankDefensePage), { ssr: false });

export function TanksClient() {
  return <TankDefensePage storage={defaultStorage} />;
}
