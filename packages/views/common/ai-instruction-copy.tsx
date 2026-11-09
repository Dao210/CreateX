"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@auro/ui/components/ui/collapsible";
import { Textarea } from "@auro/ui/components/ui/textarea";
import { useT } from "../i18n";

export function AIInstructionCopy({ instructions, label, instructionsLabel, copiedMessage, repeatLabel, descriptionId, disabled, secondary = false }: {
  instructions: string;
  label: string;
  instructionsLabel?: string;
  copiedMessage?: string;
  repeatLabel?: string;
  descriptionId?: string;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { t } = useT("common");
  const statusId = useId();
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const copied = copiedText === instructions;
  const failed = failedText === instructions;

  return <div className="grid min-w-0 gap-2">
    <Button type="button" variant={secondary ? "outline" : "default"} size={secondary ? "sm" : "default"} disabled={disabled} aria-describedby={[descriptionId, copied ? statusId : undefined].filter(Boolean).join(" ") || undefined} onClick={async () => {
      setFailedText(null);
      try {
        await navigator.clipboard.writeText(instructions);
        setCopiedText(instructions);
      } catch {
        setCopiedText(null);
        setFailedText(instructions);
      }
    }}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied && repeatLabel ? repeatLabel : label}
    </Button>
    {copied && <p id={statusId} role="status" className="text-caption leading-relaxed text-muted-foreground">{copiedMessage ?? t($ => $.ai_tools.paste_instructions)}</p>}
    {failed && <p role="alert" className="text-caption text-destructive">{t($ => $.ai_tools.copy_error)}</p>}
    <Collapsible open={expanded || failed} onOpenChange={setExpanded}>
      <CollapsibleTrigger render={<Button type="button" variant="ghost" size="xs" className="h-auto px-0 text-muted-foreground" />}>
        {t($ => $.ai_tools.show_instructions)}<ChevronDown aria-hidden className={expanded || failed ? "rotate-180" : undefined} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Textarea readOnly value={instructions} aria-label={instructionsLabel ?? t($ => $.ai_tools.full_instructions)} className="mt-2 min-h-40 max-h-64 font-mono text-caption" onFocus={event => event.currentTarget.select()} />
      </CollapsibleContent>
    </Collapsible>
  </div>;
}

export function AIConnectionSteps() {
  const { t } = useT("common");
  return <ol className="grid gap-3 text-caption leading-relaxed text-muted-foreground">
    {[t($ => $.ai_tools.step_send), t($ => $.ai_tools.step_authorize), t($ => $.ai_tools.step_return)].map((step, i) => <li key={step} className="flex items-start gap-3">
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground">{i + 1}</span>
      <span>{step}</span>
    </li>)}
  </ol>;
}
