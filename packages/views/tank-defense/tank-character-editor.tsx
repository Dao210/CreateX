"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@auro/ui/components/ui/dialog";
import { ApiError } from "@auro/core/api";
import { applyTankGrowth, compileTankCharacter, useSaveTankCharacter, type TankCharacterDraft, type TankCharacter } from "@auro/core/tank-defense";
import { useT } from "../i18n";

export function TankCharacterEditor({ open, onOpenChange, workspaceId, character, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string; character: TankCharacter | null; onSaved: (character: TankCharacter) => void }) {
  const { t } = useT("tanks");
  const [draft, setDraft] = useState<TankCharacterDraft>(() => character?.draft ?? { profile: "tank-defense@1", name: t($ => $.garage.default_name), parts: { chassis: "standard", armor: "light", cannon: "standard" }, appearance: { body: "#4f9a68", accent: "#d5ed99", pattern: "stripe" } });
  const save = useSaveTankCharacter(workspaceId);
  const request = useRef<{ input: string; id: string } | null>(null);
  let preview: ReturnType<typeof compileTankCharacter> | null = null;
  try { preview = compileTankCharacter(draft); } catch { /* Invalid drafts remain editable. */ }
  const previewBlueprint = preview ? applyTankGrowth(preview.blueprint, character?.progression?.xp) : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!preview) return;
    const input = { draft, ...(character ? { characterId: character.id, expectedRevision: character.revision } : {}) };
    const serialized = JSON.stringify(input);
    if (request.current?.input !== serialized) request.current = { input: serialized, id: crypto.randomUUID() };
    try { const result = await save.mutateAsync({ ...input, requestId: request.current.id }); onSaved(result); }
    catch { /* Preserve draft and request identity for a deliberate retry. */ }
  };
  const partLabels = { light: t($ => $.garage.light), standard: t($ => $.garage.standard), heavy: t($ => $.garage.heavy), rapid: t($ => $.garage.rapid) };
  return <Dialog open={open} onOpenChange={value => { if (!save.isPending) onOpenChange(value); }}>
    <DialogContent className="tank-character-dialog"><form onSubmit={event => void submit(event)}>
      <DialogHeader><DialogTitle>{character ? t($ => $.garage.edit) : t($ => $.garage.create)}</DialogTitle><DialogDescription>{t($ => $.garage.editor_help)}</DialogDescription></DialogHeader>
      <div className="tank-editor-fields">
        <label className="tank-form-field"><span>{t($ => $.garage.name)}</span><Input value={draft.name} maxLength={80} onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} required /></label>
        {(["chassis", "armor", "cannon"] as const).map(part => <label className="tank-form-field" key={part}><span>{t($ => $.garage[part])}</span><select value={draft.parts[part]} onChange={event => { const value = event.currentTarget.value; if ((value === "light" && part !== "cannon") || (value === "rapid" && part === "cannon") || value === "standard" || value === "heavy") setDraft({ ...draft, parts: { ...draft.parts, [part]: value } }); }}>{(part === "cannon" ? ["rapid", "standard", "heavy"] as const : ["light", "standard", "heavy"] as const).map(value => <option key={value} value={value}>{partLabels[value]}</option>)}</select></label>)}
        <div className="tank-color-fields">
          <label className="tank-form-field"><span>{t($ => $.garage.body_color)}</span><Input type="color" value={draft.appearance.body} onChange={event => setDraft({ ...draft, appearance: { ...draft.appearance, body: event.currentTarget.value } })} /></label>
          <label className="tank-form-field"><span>{t($ => $.garage.accent_color)}</span><Input type="color" value={draft.appearance.accent} onChange={event => setDraft({ ...draft, appearance: { ...draft.appearance, accent: event.currentTarget.value } })} /></label>
        </div>
        <label className="tank-form-field"><span>{t($ => $.garage.pattern)}</span><select value={draft.appearance.pattern} onChange={event => { const value = event.currentTarget.value; if (value === "solid" || value === "stripe" || value === "cross") setDraft({ ...draft, appearance: { ...draft.appearance, pattern: value } }); }}>{(["solid", "stripe", "cross"] as const).map(pattern => <option key={pattern} value={pattern}>{t($ => $.garage[pattern])}</option>)}</select></label>
        <div role="status" className={preview ? "tank-editor-preview" : "tank-garage-error"}>{preview ? <>{t($ => $.garage.budget, { cost: preview.cost })}<p>{t($ => $.garage.stats, { speed: previewBlueprint!.speed, armor: previewBlueprint!.armor, cooldown: previewBlueprint!.fireInterval })}</p></> : t($ => $.garage.invalid_draft)}</div>
        {save.isError && <p role="alert" className="tank-garage-error">{save.error instanceof ApiError && save.error.status === 409 ? t($ => $.garage.conflict) : t($ => $.garage.save_error)}</p>}
      </div>
      <DialogFooter><Button type="button" variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>{t($ => $.garage.cancel)}</Button><Button type="submit" disabled={!preview || save.isPending} aria-busy={save.isPending}>{save.isPending ? t($ => $.garage.saving) : t($ => $.garage.save)}</Button></DialogFooter>
    </form></DialogContent>
  </Dialog>;
}
