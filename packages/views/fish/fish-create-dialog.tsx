"use client";
import { useCreationEntry } from "../common/use-creation-entry";
import { useId, useState } from "react";
import { Cable } from "lucide-react";
import { api } from "@auro/core/api";
import { buildFishCreationInstructions, buildFishMCPContext, FISH_EXAMPLES, FishSpecSchema, type FishSpec } from "@auro/core/fish";
import { Button } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import { Textarea } from "@auro/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { FishDesignForm } from "./fish-editor";
import { AIInstructionCopy } from "../common/ai-instruction-copy";

export function FishCreateDialog({ workspace, userId, onSave, pending }: {
  workspace: { id: string; slug: string; name: string };
  userId: string;
  onSave: (draft: FishSpec) => Promise<boolean>;
  pending: boolean;
}) {
  const { t } = useT("fish"), navigation = useNavigation();
  const nameId = useId(), nameHelpId = useId(), connectionHelpId = useId(), visibilityId = useId();
  const [open, setOpen] = useCreationEntry();
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [releaseToPublic, setReleaseToPublic] = useState(true);
  const [spec, setSpec] = useState<FishSpec>({ ...FISH_EXAMPLES[0]!, name: t($ => $.azure) });
  const context = buildFishMCPContext({ appUrl: navigation.getShareableUrl("/"), serverUrl: api.getBaseUrl(), workspaceId: workspace.id, workspaceSlug: workspace.slug, workspaceName: workspace.name, userId });
  const instructions = buildFishCreationInstructions(context, t($ => $.create_prompt), { name, description, releaseToPublic });
  const validName = !name.trim() || FishSpecSchema.shape.name.safeParse(name.trim()).success;

  return <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
    <DialogTrigger render={<Button size="sm" />}>{t($ => $.create)}</DialogTrigger>
    <DialogContent className={manual ? "fish-editor" : "fish-create-dialog"}>
      <DialogHeader>
        <DialogTitle>{t($ => $.create)}</DialogTitle>
        <DialogDescription>{manual ? t($ => $.manual_help) : t($ => $.create_help)}</DialogDescription>
      </DialogHeader>
      {manual ? <>
        <Button variant="link" className="justify-self-start px-0" disabled={pending} onClick={() => setManual(false)}>{t($ => $.back_to_agent)}</Button>
        {open && <FishDesignForm spec={spec} onChange={value => { setSpec(value); setName(value.name); }} pending={pending} onCancel={() => setOpen(false)} onSave={async draft => {
          const saved = await onSave(draft);
          if (saved) setOpen(false);
          return saved;
        }} />}
      </> : <>
        <div className="fish-create-connection" id={connectionHelpId}><Cable aria-hidden /><p>{t($ => $.first_connection)}</p></div>
        <div className="fish-create-field"><label htmlFor={nameId}>{t($ => $.create_name)}</label>
          <Input id={nameId} value={name} maxLength={80} aria-describedby={nameHelpId} aria-invalid={!validName} onChange={e => setName(e.target.value)} />
          <span id={nameHelpId} className={validName ? "text-muted-foreground" : "text-destructive"}>{t($ => $.name_help)}</span>
        </div>
        <label className="fish-create-field"><span>{t($ => $.create_description)}</span>
          <Textarea value={description} maxLength={2000} placeholder={t($ => $.description_placeholder)} onChange={e => setDescription(e.target.value)} />
        </label>
        <div className="fish-create-publication">
          <label className="fish-check"><input type="checkbox" checked={releaseToPublic} aria-describedby={visibilityId} onChange={e => setReleaseToPublic(e.target.checked)} />{t($ => $.create_release)}</label>
          <p id={visibilityId}>{releaseToPublic ? t($ => $.release_visibility) : t($ => $.create_private)}</p>
        </div>
        <AIInstructionCopy instructions={instructions} label={t($ => $.copy_creation)} instructionsLabel={t($ => $.creation_instructions)} copiedMessage={t($ => $.creation_copied)} descriptionId={connectionHelpId} disabled={!validName} />
        <div className="fish-create-alternatives">
          <Button variant="link" onClick={() => {
            setSpec({ ...spec, name: name.trim() || spec.name });
            setManual(true);
          }}>{t($ => $.manual_design)}</Button>
          <a href={context.setup_url} target="_blank" rel="noopener noreferrer">{t($ => $.guide)}</a>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
