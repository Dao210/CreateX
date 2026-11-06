"use client";
import { useRef, useState } from "react";
import { InterestSchema, OccupationSchema, type TownCommand, type LifeSnapshot } from "@auro/core/agent-life";
import { useTownCommands } from "@auro/core/agent-life/queries";
import { Button } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import { Textarea } from "@auro/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { useT } from "../i18n";

type CommandInput = TownCommand extends infer C ? C extends TownCommand ? Omit<C, "requestId"> : never : never;
export function useSubmit(workspaceId: string) {
  const mutation = useTownCommands(workspaceId);
  const receipt = useRef<{ key: string; command: TownCommand } | null>(null);
  return { ...mutation, resetIntent: () => { receipt.current = null; mutation.reset(); }, send: async (input: CommandInput) => {
    const key = JSON.stringify(input);
    if (receipt.current?.key !== key) receipt.current = { key, command: { ...input, requestId: crypto.randomUUID() } };
    const result = await mutation.mutateAsync(receipt.current.command);
    receipt.current = null;
    return result;
  } };
}
export function ResidentDialog({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { t } = useT("life");
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [background, setBackground] = useState("");
  const [occupation, setOccupation] = useState<"artist" | ReturnType<typeof OccupationSchema.parse>>("artist");
  const [interest, setInterest] = useState<ReturnType<typeof InterestSchema.parse>>("reading");
  const command = useSubmit(workspaceId);
  return <Dialog open={open} onOpenChange={value => { if (!command.isPending) setOpen(value); }}>
    <DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>{t($ => $.add_resident)}</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{t($ => $.add_resident)}</DialogTitle><DialogDescription>{t($ => $.resident_help)}</DialogDescription></DialogHeader>
      <form className="town-form" onSubmit={async e => {
        e.preventDefault();
        try { await command.send({ kind: "resident", name: name.trim(), background: background.trim(), occupation, interests: [interest] }); setOpen(false); setName(""); setBackground(""); } catch { /* Mutation state preserves the form for retry. */ }
      }}>
        <label>{t($ => $.resident_name)}<Input value={name} onChange={e => setName(e.target.value)} maxLength={40} required disabled={command.isPending} /></label>
        <label>{t($ => $.occupation)}<select aria-label={t($ => $.occupation)} value={occupation} onChange={e => setOccupation(OccupationSchema.parse(e.target.value))} disabled={command.isPending}>{OccupationSchema.options.map(value => <option key={value} value={value}>{t($ => $.occupations[value])}</option>)}</select></label>
        <label>{t($ => $.interest)}<select aria-label={t($ => $.interest)} value={interest} onChange={e => setInterest(InterestSchema.parse(e.target.value))} disabled={command.isPending}>{InterestSchema.options.map(value => <option key={value} value={value}>{t($ => $.interests[value])}</option>)}</select></label>
        <label>{t($ => $.background)}<Textarea value={background} onChange={e => setBackground(e.target.value)} maxLength={400} disabled={command.isPending} /></label>
        {command.isError && <p role="alert" className="text-caption text-destructive">{t($ => $.command_error)}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={command.isPending} onClick={() => setOpen(false)}>{t($ => $.cancel)}</Button><Button type="submit" disabled={command.isPending || !name.trim()} aria-busy={command.isPending}>{t($ => $.welcome)}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
export function ActivityDialog({ workspaceId, data, residentId }: { workspaceId: string; data: LifeSnapshot; residentId: string }) {
  const { t } = useT("life");
  const [open, setOpen] = useState(false), [title, setTitle] = useState("");
  const [interest, setInterest] = useState<ReturnType<typeof InterestSchema.parse>>("reading");
  const [place, setPlace] = useState<"cafe" | "library" | "square">("cafe");
  const minute = (data.world?.tick ?? 0) % 1440;
  const [startsIn, setStartsIn] = useState(() => (minute + 60) % 1440 >= 420 && (minute + 60) % 1440 <= 1260 ? 60 : (480 - minute + 1440) % 1440);
  const options = [...new Set([30, 60, 120, 240, 480, 720, 1080, 1200, startsIn])].sort((a, b) => a - b);
  const command = useSubmit(workspaceId);
  const time = (data.world?.tick ?? 0) + startsIn;
  const clock = `${String(Math.floor(time % 1440 / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
  return <Dialog open={open} onOpenChange={value => { if (!command.isPending) setOpen(value); }}>
    <DialogTrigger render={<Button variant="outline" size="sm" disabled={data.town?.model.mode === "llm" && ["unconfigured", "budget"].includes(data.town.model.state)} />}>{t($ => $.suggest_activity)}</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{t($ => $.suggest_activity)}</DialogTitle><DialogDescription>{t($ => $.activity_help, { name: data.agents.find(a => a.id === residentId)?.name })}</DialogDescription></DialogHeader>
      <form className="town-form" onSubmit={async e => { e.preventDefault(); try { await command.send({ kind: "activity", residentId, title: title.trim(), interest, place: place === "library" ? "library" : place === "square" ? "square" : "cafe", startsIn, duration: 60 }); setOpen(false); setTitle(""); } catch { /* Preserve input for retry. */ } }}>
        <label>{t($ => $.activity_title)}<Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t($ => $.activity_placeholder)} maxLength={80} required disabled={command.isPending} /></label>
        <label>{t($ => $.interest)}<select aria-label={t($ => $.interest)} value={interest} onChange={e => setInterest(InterestSchema.parse(e.target.value))} disabled={command.isPending}>{InterestSchema.options.map(value => <option key={value} value={value}>{t($ => $.interests[value])}</option>)}</select></label>
        <label>{t($ => $.venue)}<select aria-label={t($ => $.venue)} value={place} onChange={e => setPlace(e.target.value === "library" ? "library" : e.target.value === "square" ? "square" : "cafe")} disabled={command.isPending}>{(["cafe", "library", "square"] as const).map(value => <option key={value} value={value}>{t($ => $.places[value])}</option>)}</select></label>
        <p className="town-note">{t($ => $.venue_hours[place])}</p>
        <label>{t($ => $.starts_in)}<select aria-label={t($ => $.starts_in)} value={startsIn} onChange={e => setStartsIn(Number(e.target.value))} disabled={command.isPending}>{options.map(value => <option key={value} value={value}>{t($ => $.minutes, { count: value })}</option>)}</select></label>
        <p className="town-note">{t($ => $.activity_time, { time: clock })}</p>
        {command.isError && <p role="alert" className="text-caption text-destructive">{t($ => $.command_error)}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={command.isPending} onClick={() => setOpen(false)}>{t($ => $.cancel)}</Button><Button type="submit" disabled={command.isPending || !title.trim()} aria-busy={command.isPending}>{t($ => $.suggest)}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
export function ResidentTalk({ workspaceId, data, residentId }: { workspaceId: string; data: LifeSnapshot; residentId: string }) {
  const { t } = useT("life");
  const [text, setText] = useState(""), [jobId, setJobId] = useState("");
  const command = useSubmit(workspaceId);
  const job = data.town?.jobs.find(j => j.id === jobId);
  const waiting = job?.status === "queued" || job?.status === "running";
  const ready = data.town?.model.mode === "llm" && !["unconfigured", "budget"].includes(data.town.model.state);
  return <form className="town-talk" onSubmit={async e => { e.preventDefault(); try { const result = await command.send({ kind: "message", residentId, text: text.trim() }); setJobId(result.id); setText(""); } catch { /* Preserve the message for a retry with its request identity. */ } }}>
    <label className="town-section-title" htmlFor={`town-message-${residentId}`}>{t($ => $.talk_to, { name: data.agents.find(a => a.id === residentId)?.name })}</label>
    <Textarea id={`town-message-${residentId}`} value={text} onChange={e => setText(e.target.value)} maxLength={1000} disabled={!ready || command.isPending || waiting} />
    <p className="town-note">{ready ? t($ => $.talk_visibility) : t($ => $.model_required)}</p>
    <Button type="submit" size="sm" disabled={!ready || !text.trim() || command.isPending || waiting} aria-busy={command.isPending || waiting}>{t($ => $.send)}</Button>
    {(command.isError || job?.status === "error") && <p role="alert" className="text-caption text-destructive">{t($ => $.command_error)}</p>}
    {job?.status === "error" && <Button type="button" variant="outline" size="sm" onClick={() => { command.resetIntent(); setText(job.text); setJobId(""); }}>{t($ => $.retry)}</Button>}
    {waiting && <p role="status" className="town-note">{t($ => $.reply_pending)}</p>}
  </form>;
}
