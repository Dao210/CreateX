"use client";
import { defaultStorage } from "@auro/core/platform";
import { LifePage } from "@auro/views/agent-life";
export function LifeClient() { return <LifePage storage={defaultStorage} />; }
