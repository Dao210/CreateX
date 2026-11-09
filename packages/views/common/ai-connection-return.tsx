"use client";

import { Cable, X } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { AIInstructionCopy } from "./ai-instruction-copy";

export function AIConnectionReturn({ source, instructions, className = "" }: { source: string; instructions: string; className?: string }) {
  const navigation = useNavigation();
  const { t } = useT("common");
  if (navigation.searchParams.get("from") !== source) return null;

  return <aside role="region" aria-label={t($ => $.ai_tools.return_title)} className={`flex min-w-0 items-start gap-3 rounded-md border bg-muted p-3 text-caption text-muted-foreground ${className}`}>
    <Cable aria-hidden className="mt-0.5 size-4 shrink-0" />
    <div className="grid min-w-0 flex-1 gap-3">
      <div className="grid gap-1">
        <p className="font-medium text-foreground">{t($ => $.ai_tools.return_title)}</p>
        <p className="leading-relaxed">{t($ => $.ai_tools.return_help)}</p>
      </div>
      <AIInstructionCopy instructions={instructions} label={t($ => $.ai_tools.copy_continue)} copiedMessage={t($ => $.ai_tools.paste_continue)} secondary />
      <p className="leading-relaxed">{t($ => $.ai_tools.new_chat_help)}</p>
    </div>
    <Button variant="ghost" size="icon-sm" aria-label={t($ => $.ai_tools.dismiss)} onClick={() => {
      const params = new URLSearchParams(navigation.searchParams);
      params.delete("from");
      navigation.replace(`${navigation.pathname}${params.size ? `?${params}` : ""}${navigation.hash}`);
    }}><X aria-hidden /></Button>
  </aside>;
}
