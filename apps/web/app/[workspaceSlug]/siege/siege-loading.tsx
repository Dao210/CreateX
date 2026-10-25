"use client";

import { AuroIcon } from "@auro/ui/components/common/auro-icon";

// Shared placeholder while the game bundle (Rapier + canvas painters) loads.
// Kept out of @auro/views: it is a route-level concern, not part of the game.
export function SiegeLoading() {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#f6f2e6]">
      <AuroIcon className="size-6" />
    </div>
  );
}
