"use client";
import "@auro/views/capture-the-flag/ctf.css";
import dynamic from "next/dynamic";
import { defaultStorage } from "@auro/core/platform";
const CTFPage = dynamic(() => import("@auro/views/capture-the-flag").then(m => m.CTFPage), { ssr: false });
export function CTFClient() { return <CTFPage storage={defaultStorage} />; }
