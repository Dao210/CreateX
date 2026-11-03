"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Clock, LoaderCircle } from "lucide-react";
import { cn } from "@auro/ui/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@auro/ui/components/ui/tooltip";
import type { ChatQuickAction } from "@auro/core/types";
import { useT } from "../../i18n";

/**
 * Product-fixed starter cards rendered under Mika's onboarding opening (the
 * first assistant reply after the hidden `onboarding_kickoff`). They replace
 * that one message's LLM quick-action chips with three concrete ways to start,
 * so a new member never faces a blank canvas (MUL-5765).
 *
 * Clicking a card goes through the same path as a quick-action chip: the
 * card's prompt is sent as a visible member message and Mika starts working.
 * The cards stay in the session history and remain clickable; while any task
 * is running they follow the chips' disabled rule via `disabled`.
 */
export function OnboardingStarterCards({
  onPick,
  disabled,
}: {
  onPick: (action: ChatQuickAction) => void | Promise<unknown>;
  disabled: boolean;
}) {
  const { t } = useT("chat");
  const [submitting, setSubmitting] = useState(false);
  const blocked = disabled || submitting;

  const cards = [
    {
      key: "plan",
      title: t(($) => $.onboarding_cards.plan.title),
      desc: t(($) => $.onboarding_cards.plan.desc),
      prompt: t(($) => $.onboarding_cards.plan.prompt),
      vignette: <PlanVignette />,
    },
    {
      key: "delegate",
      title: t(($) => $.onboarding_cards.delegate.title),
      desc: t(($) => $.onboarding_cards.delegate.desc),
      prompt: t(($) => $.onboarding_cards.delegate.prompt),
      vignette: <DelegateVignette />,
    },
    {
      key: "digest",
      title: t(($) => $.onboarding_cards.digest.title),
      desc: t(($) => $.onboarding_cards.digest.desc),
      prompt: t(($) => $.onboarding_cards.digest.prompt),
      vignette: <DigestVignette />,
    },
  ];

  const handlePick = async (card: (typeof cards)[number]) => {
    if (blocked) return;
    setSubmitting(true);
    try {
      await onPick({ label: card.title, prompt: card.prompt });
    } catch {
      // The send path owns user-facing error feedback; re-enable so a
      // transient failure can be retried.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mt-3 grid grid-cols-1 gap-3 @2xl:grid-cols-3"
      aria-label={t(($) => $.onboarding_cards.aria_label)}
    >
      {cards.map((card) => (
        // Same learn-then-commit contract as the quick-action chips: the whole
        // card previews the exact message it will send in the member's name.
        <Tooltip key={card.key}>
          <TooltipTrigger
            render={
              <button
                type="button"
                disabled={blocked}
                aria-label={card.title}
                onClick={() => void handlePick(card)}
                className={cn(
                  "group flex flex-col overflow-clip rounded-xl border bg-card text-left transition-colors",
                  "hover:border-brand/40 hover:bg-accent/40",
                  "disabled:pointer-events-none disabled:opacity-55",
                )}
              />
            }
          >
            <div className="flex h-26 shrink-0 items-center justify-center bg-gradient-to-b from-muted/55 to-transparent">
              {card.vignette}
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-start px-3.5 pt-3 pb-3.5">
              <div className="text-body-lg font-medium">{card.title}</div>
              <div className="mt-0.5 text-caption text-muted-foreground">
                {card.desc}
              </div>
              <div className="mt-auto flex items-center gap-1 pt-2.5 text-label font-medium text-brand">
                {t(($) => $.onboarding_cards.cta)}
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap break-words">
            {card.prompt}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ─── Vignettes ───────────────────────────────────────────────────────────
//
// Token-drawn product miniatures, not bitmaps: they inherit the theme, so the
// same markup holds in light and dark. Decorative throughout (aria-hidden);
// no text except the digest schedule badge, which is real localized copy.

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-1 rounded-full bg-muted-foreground/30", className)}
    />
  );
}

function MiniCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xs border border-border bg-card px-1.5 py-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

// A written plan with three concrete steps.
function PlanVignette() {
  return (
    <div aria-hidden="true" className="w-40 rounded-md border bg-card p-3">
      <Bar className="mb-3 w-2/3 bg-brand/50" />
      {["w-5/6", "w-2/3", "w-3/4"].map((width) => (
        <div key={width} className="mt-2 flex items-center gap-2">
          <span className="size-2 rounded-full border border-brand/50" />
          <Bar className={width} />
        </div>
      ))}
    </div>
  );
}

// A task running under Mika, and a delivered result beneath it.
function DelegateVignette() {
  return (
    <div aria-hidden="true" className="flex w-45 flex-col gap-1.5">
      <MiniCard className="flex-row items-center gap-1.5 px-2 py-1.5">
        <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-micro leading-none">
          🦄
        </span>
        <div className="flex flex-1 flex-col gap-1">
          <Bar className="w-5/6" />
          <Bar className="w-1/2" />
        </div>
        <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
      </MiniCard>
      <MiniCard className="flex-row items-center gap-1.5 px-2 py-1.5">
        <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />
        <div className="flex flex-1 flex-col gap-1">
          <Bar className="w-2/3" />
          <Bar className="w-5/6" />
        </div>
      </MiniCard>
    </div>
  );
}

// An inbox digest: schedule badge plus three summary rows.
function DigestVignette() {
  const { t } = useT("chat");
  return (
    <div className="flex w-43 flex-col gap-1.5">
      <div className="flex items-center gap-1 self-start rounded-full bg-brand/12 px-2 py-0.5 text-micro font-semibold text-brand">
        <Clock aria-hidden="true" className="size-2.5" />
        {t(($) => $.onboarding_cards.digest_badge)}
      </div>
      <div aria-hidden="true" className="flex flex-col gap-1">
        <MiniCard className="flex-row items-center gap-1.5 px-1.5 py-1">
          <div className="size-1.5 rounded-full bg-brand" />
          <Bar className="w-4/5" />
        </MiniCard>
        <MiniCard className="flex-row items-center gap-1.5 px-1.5 py-1">
          <div className="size-1.5 rounded-full bg-muted-foreground/40" />
          <Bar className="w-3/5" />
        </MiniCard>
        <MiniCard className="flex-row items-center gap-1.5 px-1.5 py-1 opacity-60">
          <div className="size-1.5 rounded-full bg-muted-foreground/40" />
          <Bar className="w-2/3" />
        </MiniCard>
      </div>
    </div>
  );
}
