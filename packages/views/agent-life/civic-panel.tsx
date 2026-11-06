"use client";
import { useState } from "react";
import { Hammer, Landmark, PackagePlus, Sprout, Users } from "lucide-react";
import { STORAGE_DESIGNS, StorageVariantSchema, type CivicNews, type LifeSnapshot, type StorageVariant } from "@auro/core/agent-life";
import { Button } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import { Progress } from "@auro/ui/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { useT } from "../i18n";
import { useSubmit } from "./town-forms";

export function CivicNewsText({ news, data }: { news: CivicNews; data: LifeSnapshot }) {
  const { t } = useT("life");
  const key = news.kind === "declined" ? "declined_event" : news.kind === "tradition" ? "tradition_event" : news.kind;
  return <>{t($ => $.civic[key], { name: data.agents.find(agent => agent.id === news.residentId)?.name ?? "", amount: news.amount })}</>;
}
export function PrototypeDialog({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const { t } = useT("life");
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [variant, setVariant] = useState<StorageVariant>("light");
  const command = useSubmit(workspaceId);
  return <Dialog open={open} onOpenChange={value => { if (!command.isPending) setOpen(value); }}>
    <DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}><PackagePlus />{t($ => $.civic.prototype)}</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{t($ => $.civic.prototype)}</DialogTitle><DialogDescription>{t($ => $.civic.design_help)}</DialogDescription></DialogHeader>
      <form className="town-form" onSubmit={async event => { event.preventDefault(); try { await command.send({ kind: "prototype", name: name.trim(), variant }); setOpen(false); setName(""); } catch { /* Keep the intention and input for retry. */ } }}>
        <label>{t($ => $.civic.prototype_name)}<Input required value={name} onChange={event => setName(event.target.value)} maxLength={60} disabled={command.isPending} /></label>
        <fieldset className="town-designs" disabled={command.isPending}><legend>{t($ => $.civic.select_design)}</legend>{StorageVariantSchema.options.map(value => <label className="town-design" key={value} data-selected={value === variant}><input type="radio" name="storage-variant" value={value} checked={value === variant} onChange={() => setVariant(value)} /><strong>{t($ => $.civic[value])}</strong><span>{t($ => $.civic.design_cost, STORAGE_DESIGNS[value])}</span></label>)}</fieldset>
        {command.isError && <p role="alert" className="town-note">{t($ => $.command_error)}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={command.isPending}>{t($ => $.cancel)}</Button><Button type="submit" disabled={!name.trim() || command.isPending} aria-busy={command.isPending}>{t($ => $.civic.create)}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
export function SuggestProject({ workspaceId, data, residentId }: { workspaceId: string; data: LifeSnapshot; residentId: string }) {
  const { t } = useT("life");
  const [open, setOpen] = useState(false), [prototypeId, setPrototypeId] = useState("");
  const command = useSubmit(workspaceId);
  const civ = data.town?.civilization;
  const selectedId = civ?.prototypes.some(row => row.id === prototypeId) ? prototypeId : civ?.prototypes[0]?.id ?? "";
  return <Dialog open={open} onOpenChange={value => { if (!command.isPending) setOpen(value); }}>
    <DialogTrigger render={<Button size="sm" variant="outline" disabled={!civ?.prototypes.length || civ.projects.length >= 3 || civ.suggestions.length >= 24} />}><Sprout />{t($ => $.civic.suggest)}</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{t($ => $.civic.suggest)}</DialogTitle><DialogDescription>{t($ => $.civic.suggest_help, { name: data.agents.find(agent => agent.id === residentId)?.name })}</DialogDescription></DialogHeader>
      <form className="town-form" onSubmit={async event => { event.preventDefault(); try { await command.send({ kind: "suggest_project", residentId, prototypeId: selectedId }); setOpen(false); } catch { /* Preserve the suggestion for retry. */ } }}>
        <label>{t($ => $.civic.select_design)}<select aria-label={t($ => $.civic.select_design)} value={selectedId} onChange={event => setPrototypeId(event.target.value)} disabled={command.isPending} required>{civ?.prototypes.map(row => <option value={row.id} key={row.id}>{row.name || t($ => $.civic[row.variant])}</option>)}</select></label>
        {command.isError && <p role="alert" className="town-note">{t($ => $.command_error)}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={command.isPending}>{t($ => $.cancel)}</Button><Button type="submit" disabled={!selectedId || command.isPending} aria-busy={command.isPending}>{t($ => $.suggest)}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
export function CivicPanel({ data, selectedProjectId, onSelect }: { data: LifeSnapshot; selectedProjectId?: string; onSelect: (id: string) => void }) {
  const { t } = useT("life");
  const civ = data.town?.civilization;
  const project = civ?.projects.find(row => row.id === selectedProjectId) ?? civ?.projects[0];
  const name = (id: string) => data.agents.find(agent => agent.id === id)?.name ?? "";
  const prototype = civ?.prototypes.find(row => row.id === project?.prototypeId);
  const design = project && STORAGE_DESIGNS[project.variant];
  const debate = civ?.debates.find(row => row.projectId === project?.id && row.status === "open");
  return <section className="town-civic" aria-label={t($ => $.civic.title)}>
    <header className="town-civic-header"><Landmark aria-hidden /><h3>{t($ => $.civic.title)}</h3></header>
    {!project && <p className="town-note">{t($ => $.civic.empty)}</p>}
    {!!civ?.projects.length && <div className="town-project-tabs">{civ.projects.map(row => <Button key={row.id} size="sm" variant={project?.id === row.id ? "secondary" : "ghost"} aria-pressed={project?.id === row.id} onClick={() => onSelect(row.id)}>{civ.prototypes.find(p => p.id === row.prototypeId)?.name || t($ => $.civic.project)}</Button>)}</div>}
    {project && design && <article className="town-project" data-testid="civic-project">
      <div className="town-project-heading"><div><span className="town-overline">{t($ => $.civic.status[project.status])}</span><h4>{prototype?.name || t($ => $.civic[project.variant])}</h4></div><Hammer aria-hidden /></div>
      <p className="town-note">{name(project.organizerId)} · {t($ => prototype?.authorId ? $.civic.author : $.civic.resident_design)}</p>
      <div className="town-project-stats"><span><Users size={14} />{t($ => $.civic.members, { count: project.members.length })}</span><span>{t($ => $.civic.condition, { amount: project.condition })}</span></div>
      <div className="town-project-progress"><span>{t($ => $.civic.wood, { amount: project.wood, target: design.wood })}</span><Progress value={project.wood / design.wood * 100} aria-label={t($ => $.wood)} /><span>{t($ => $.civic.labor, { amount: project.labor, target: design.labor })}</span><Progress value={project.labor / design.labor * 100} aria-label={t($ => $.actions.BUILD)} /><span>{t($ => $.civic.food, { amount: project.food, target: design.capacity })}</span><Progress value={project.food / design.capacity * 100} aria-label={t($ => $.actions.STORE_FOOD)} /></div>
      <details className="town-agreement" open><summary>{t($ => $.civic.rules, { revision: project.rule.revision })}</summary><p>{t($ => $.civic[project.rule.distribution])} · {t($ => $.civic[project.rule.maintenance])}</p>{debate && <p>{t($ => $.civic.debate)} · {t($ => $.civic.votes, { yes: debate.votes.filter(vote => vote.approve).length, total: debate.votes.length })}</p>}</details>
      <div className="town-project-members">{project.members.map(row => <span className="town-badge" key={row.residentId}>{name(row.residentId)}</span>)}</div>
      {project.gatheringsCompleted > 0 && <p className="town-note">{t($ => $.civic.tradition, { count: project.gatheringsCompleted })}</p>}
      <details className="town-project-history"><summary>{t($ => $.civic.history)}</summary><ol>{civ?.news.filter(row => row.projectId === project.id && row.kind !== "discovered" && row.kind !== "rule_voted").slice(-10).reverse().map(row => <li key={row.id}><time>{Math.floor(row.tick / 1440) + 1} · {String(Math.floor(row.tick % 1440 / 60)).padStart(2, "0")}:{String(row.tick % 60).padStart(2, "0")}</time><CivicNewsText news={row} data={data} />{row.rule && <p>{t($ => $.civic[row.rule!.distribution])} · {t($ => $.civic[row.rule!.maintenance])}</p>}{row.evidence.length > 0 && <small>{t($ => $.civic.causes, { count: row.evidence.length })}</small>}</li>)}</ol></details>
    </article>}
    {(civ?.suggestions.length ?? 0) > 0 && <div className="town-suggestions">{civ?.suggestions.slice(-3).reverse().map(row => <p className="town-note" key={row.id}>{name(row.residentId)} · {civ.prototypes.find(p => p.id === row.prototypeId)?.name} · {t($ => $.civic[row.status])}</p>)}</div>}
  </section>;
}
