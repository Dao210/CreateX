"use client";

import { lazy, Suspense } from "react";
import { SurfaceLoading } from "../common/surface-loading";
import { useSearchStore } from "./search-store";

const SearchCommandContent = lazy(() => import("./search-command").then((module) => ({ default: module.SearchCommand })));

export function SearchCommand() {
  const open = useSearchStore((state) => state.open);
  return open ? <Suspense fallback={<SurfaceLoading />}><SearchCommandContent /></Suspense> : null;
}
