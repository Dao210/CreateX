"use client";

import { BrandMark } from "@auro/ui/components/common/brand-mark";
import { cn } from "@auro/ui/lib/utils";
import { useT } from "../i18n";
import { DragStrip } from "../platform/drag-strip";

/** Shared startup and world-loading feedback for web and desktop. */
export function AppLoading({
  label,
  fullScreen = true,
  className,
}: {
  label?: string;
  fullScreen?: boolean;
  className?: string;
}) {
  const { t } = useT("common");
  const message = label ?? t(($) => $.loading);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={message}
      className={cn(
        "flex w-full flex-col bg-background",
        fullScreen ? "h-svh" : "h-full",
        className,
      )}
    >
      {fullScreen && <DragStrip />}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-10",
          fullScreen && "pt-0 pb-12",
        )}
      >
        <BrandMark className="h-auto w-16 shrink-0 text-foreground motion-safe:animate-pulse" />
        <p className="max-w-md break-words text-center text-body text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}
