"use client";

import { useEffect, useState } from "react";
import { useNavigation } from "../navigation";

/** Consume the entry intent once the real creation dialog is available. */
export function useCreationEntry(enabled = true) {
  const { pathname, searchParams, hash, replace } = useNavigation();
  const query = searchParams.toString();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(query);
    if (!enabled || params.get("create") !== "1") return;
    setOpen(true);
    params.delete("create");
    replace(`${pathname}${params.size ? `?${params}` : ""}${hash}`);
  }, [enabled, pathname, query, hash, replace]);
  return [open, setOpen] as const;
}
