"use client";
import "@auro/views/fish/fish.css";
import dynamic from "next/dynamic";
import { defaultStorage } from "@auro/core/platform";
const FishPage = dynamic(() => import("@auro/views/fish").then(module => module.FishPage), { ssr: false });
export function FishClient() { return <FishPage storage={defaultStorage} />; }
