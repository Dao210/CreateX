"use client";

import { useIsMobile } from "@auro/ui/hooks/use-mobile";
import { useCommentComposerStore } from "@auro/core/issues/stores";

/**
 * Whether the bottom comment composer is pinned to the scroll viewport.
 *
 * The stored preference (Settings → Preferences) is the user's answer for a
 * screen with room to spare. A narrow viewport is not that screen:
 *
 *  - Pinned, the composer costs ~15% of a phone viewport permanently, on a
 *    surface people mostly read rather than write on.
 *
 * Below `md` the composer therefore rides the end of the timeline, which is
 * where a phone reader scrolls to comment anyway. The preference is not
 * rewritten — it still applies the moment the viewport is wide enough.
 *
 * Both the composer and its host read this, so the pinning and the 40vh height
 * cap that only makes sense while pinned can never disagree.
 */
export function useStickyComposer(): boolean {
  const preferred = useCommentComposerStore((s) => s.sticky);
  const isMobile = useIsMobile();
  return preferred && !isMobile;
}
