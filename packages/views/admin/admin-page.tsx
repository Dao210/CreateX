"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Check, ChevronLeft, ChevronRight, Code2, Copy, Loader2, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { adminAccessOptions, adminMCPServicesOptions, adminMCPActivityOptions, useUpdateMCPPolicy, type MCPAdminService, type MCPActivityFilter, type UpdateMCPPolicyInput } from "@auro/core/admin";
import { api, ApiError } from "@auro/core/api";
import { paths } from "@auro/core/paths";
import { Button } from "@auro/ui/components/ui/button";
import { Switch } from "@auro/ui/components/ui/switch";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@auro/ui/components/ui/dialog";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { DragStrip } from "../platform";

export function AdminPage({ onClose }: { onClose?: () => void }) {
  const { t } = useT("admin");
  const navigation = useNavigation();
  const user = useAuthStore(state => state.user);
  const authLoading = useAuthStore(state => state.isLoading);
  const access = useQuery(adminAccessOptions(user?.id ?? ""));
  useEffect(() => { if (!authLoading && !user) navigation.replace(`${paths.login()}?next=${encodeURIComponent(paths.admin())}`); }, [authLoading,user,navigation]);
  const back = () => onClose ? onClose() : navigation.push(paths.root());
  return <div className="admin-root"><DragStrip />
    <div className="admin-shell">
      <aside className="admin-sidebar"><div className="admin-brand"><ShieldCheck /><strong>{t($ => $.brand)}</strong><span>ADMIN</span></div>
        <div className="admin-sidebar-label">{t($ => $.title)}</div>
        <div className="admin-nav-current" aria-current="page"><Server />{t($ => $.mcp)}</div>
        <div className="admin-sidebar-bottom"><span title={user?.email}>{user?.email}</span><Button variant="ghost" onClick={back}><ArrowLeft />{t($ => $.back)}</Button></div>
      </aside>
      <main className="admin-main">
        <header className="admin-header"><div><span>{t($ => $.global_scope)}</span><h1>{t($ => $.mcp)}</h1></div><span className="admin-admin-badge"><ShieldCheck />{t($ => $.admin_access)}</span></header>
        {authLoading || !user || access.isPending ? <div className="admin-state" role="status"><Loader2 className="animate-spin" />{t($ => $.checking)}</div>
          : access.isError ? <div className="admin-state" role="alert"><p>{t($ => $.load_error)}</p><Button variant="outline" onClick={() => void access.refetch()}>{t($ => $.refresh)}</Button></div>
            : !access.data.isAdmin ? <div className="admin-state" role="alert"><ShieldCheck /><h2>{t($ => $.forbidden)}</h2><p>{access.data.configured ? t($ => $.forbidden_help) : t($ => $.unconfigured_help)}</p></div>
              : <MCPManager key={user.id} userId={user.id} />}
      </main>
    </div>
  </div>;
}

function MCPManager({userId}: {userId: string}) {
  const { t } = useT("admin");
  const services = useQuery(adminMCPServicesOptions(userId,true));
  const [selectedId,setSelectedId] = useState("");
  if (services.isPending) return <div className="admin-state" role="status"><Loader2 className="animate-spin" />{t($ => $.loading)}</div>;
  if (services.isError) return <div className="admin-state" role="alert"><p>{t($ => $.load_error)}</p><Button variant="outline" onClick={() => void services.refetch()}>{t($ => $.refresh)}</Button></div>;
  const selected = services.data.find(service => service.id===selectedId) ?? services.data[0];
  const totals = services.data.reduce((total,service) => ({ calls:total.calls+service.stats.calls,errors:total.errors+service.stats.errors,blocked:total.blocked+service.stats.blocked }),{calls:0,errors:0,blocked:0});
  return <div className="admin-content">
    <div className="admin-section-heading"><p>{t($ => $.scope_help)}</p><Button variant="outline" size="sm" aria-busy={services.isFetching} disabled={services.isFetching} onClick={() => void services.refetch()}><RefreshCw />{t($ => $.refresh)}</Button></div>
    <div className="admin-metrics">
      {[[t($ => $.services),services.data.length],[t($ => $.calls_24h),totals.calls],[t($ => $.errors_24h),totals.errors],[t($ => $.blocked_24h),totals.blocked]].map(([label,value]) => <div className="admin-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <div className="admin-service-tabs">{services.data.map(service => <Button key={service.id} variant={selected?.id===service.id ? "secondary" : "ghost"} aria-pressed={selected?.id===service.id} onClick={() => setSelectedId(service.id)}><Server />{service.name}<span className={`admin-dot ${service.policy.enabled ? "admin-dot-on" : ""}`} /></Button>)}</div>
    {selected ? <><ServicePolicy key={selected.id} service={selected} userId={userId} /><ActivityLog key={`activity-${selected.id}`} service={selected} userId={userId} /></> : <div className="admin-state">{t($ => $.empty_services)}</div>}
  </div>;
}

function ServicePolicy({service,userId}: {service: MCPAdminService; userId: string}) {
  const {t,i18n} = useT("admin");
  const navigation = useNavigation();
  const [draft,setDraft] = useState<UpdateMCPPolicyInput | null>(null);
  const [copied,setCopied] = useState(false);
  const update = useUpdateMCPPolicy(userId);
  const value = draft ?? {enabled:service.policy.enabled,disabledTools:service.policy.disabledTools,expectedRevision:service.policy.revision};
  const conflict = Boolean(draft && draft.expectedRevision!==service.policy.revision);
  const server = api.getBaseUrl() || new URL(navigation.getShareableUrl("/")).origin;
  const endpoint = `${server}${service.endpoint}`;
  const change = (input: Partial<UpdateMCPPolicyInput>) => { setDraft({...value,...input}); update.reset(); };
  const save = async () => { try { await update.mutateAsync({serviceId:service.id,input:value}); setDraft(null); } catch { /* Preserve the proposed policy for review and retry. */ } };
  return <section className="admin-panel" aria-labelledby="admin-service-title">
    <div className="admin-panel-heading"><div><span className="admin-eyebrow">{t($ => $.provided_service)}</span><h2 id="admin-service-title">{service.name}</h2></div>
      <label className="admin-service-switch"><span>{t($ => $.service_enabled)}</span><Switch checked={value.enabled} disabled={update.isPending} onCheckedChange={enabled => change({enabled})} /></label></div>
    <div className="admin-endpoint"><code>{endpoint}</code><Button size="icon-sm" variant="ghost" aria-label={t($ => $.copy_endpoint)} onClick={async () => { try { await navigator.clipboard.writeText(endpoint); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check /> : <Copy />}</Button><span>{t($ => $.protocol,{version:service.protocolVersion})}</span></div>
    <div className="admin-tools-heading"><h3>{t($ => $.tools)}</h3><span>{service.tools.length}</span></div>
    <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>{t($ => $.tool)}</th><th>{t($ => $.access)}</th><th>{t($ => $.calls_24h)}</th><th>{t($ => $.errors_24h)}</th><th>{t($ => $.average_ms)}</th><th>{t($ => $.schema)}</th><th>{t($ => $.enabled)}</th></tr></thead>
      <tbody>{service.tools.map(tool => { const stats=service.toolStats[tool.name]; return <tr key={tool.name}><td><code>{tool.name}</code></td><td><span className="admin-tag">{tool.readOnly ? t($ => $.read_only) : t($ => $.write)}</span></td><td>{stats?.calls ?? 0}</td><td>{stats?.errors ?? 0}</td><td>{t($ => $.milliseconds,{value:Math.round(stats?.averageMs ?? 0)})}</td>
        <td><Dialog><DialogTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t($ => $.view_schema,{name:tool.name})} />}><Code2 /></DialogTrigger><DialogContent className="admin-schema-dialog"><DialogHeader><DialogTitle>{tool.name}</DialogTitle><DialogDescription>{tool.description}</DialogDescription></DialogHeader><pre tabIndex={0}>{JSON.stringify(tool.inputSchema,null,2)}</pre></DialogContent></Dialog></td>
        <td><Switch size="sm" aria-label={t($ => $.tool_enabled,{name:tool.name})} checked={!value.disabledTools.includes(tool.name)} disabled={update.isPending} onCheckedChange={enabled => change({disabledTools:enabled ? value.disabledTools.filter(name => name!==tool.name) : [...value.disabledTools,tool.name]})} /></td></tr>; })}</tbody></table></div>
    <div className="admin-policy-footer"><div><p>{t($ => $.policy_effect)}</p>{service.policy.updatedAt && <span>{t($ => $.updated_at,{time:new Date(service.policy.updatedAt).toLocaleString(i18n.language),revision:service.policy.revision})}</span>}
      {(conflict || update.isError) && <p role="alert" className="admin-error">{conflict || update.error instanceof ApiError && update.error.status===409 ? t($ => $.conflict) : t($ => $.save_error)}</p>}</div>
      <div className="admin-actions">{draft && <Button variant="outline" disabled={update.isPending} onClick={() => {setDraft(null);update.reset();}}>{t($ => $.reset)}</Button>}<Button disabled={!draft || conflict || update.isPending} aria-busy={update.isPending} onClick={() => void save()}>{update.isPending ? <Loader2 className="animate-spin" /> : null}{update.isPending ? t($ => $.saving) : t($ => $.save)}</Button></div></div>
  </section>;
}

function ActivityLog({service,userId}: {service: MCPAdminService; userId: string}) {
  const {t,i18n} = useT("admin");
  const [filter,setFilter] = useState<MCPActivityFilter>({});
  const [cursors,setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const activity = useQuery(adminMCPActivityOptions(userId,service.id,{...filter,cursor},true));
  const setFilters = (input: MCPActivityFilter) => {setFilter(input);setCursors([]);};
  const outcomeLabel = (outcome: string) => { switch(outcome) {case "success":return t($ => $.success); case "error":return t($ => $.error);case "blocked":return t($ => $.blocked);case "updated":return t($ => $.policy_changed);default:return outcome;} };
  return <section className="admin-panel" aria-labelledby="admin-activity-title"><div className="admin-panel-heading"><div><span className="admin-eyebrow">{t($ => $.retention)}</span><h2 id="admin-activity-title"><Activity />{t($ => $.activity)}</h2></div><Button variant="ghost" size="icon-sm" aria-label={t($ => $.refresh_activity)} disabled={activity.isFetching} onClick={() => void activity.refetch()}><RefreshCw /></Button></div>
    <div className="admin-filters"><label><span>{t($ => $.tool)}</span><select value={filter.tool ?? ""} onChange={event => setFilters({...filter,tool:event.currentTarget.value})}><option value="">{t($ => $.all_tools)}</option>{service.tools.map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></label><label><span>{t($ => $.outcome)}</span><select value={filter.outcome ?? ""} onChange={event => setFilters({...filter,outcome:event.currentTarget.value})}><option value="">{t($ => $.all_outcomes)}</option>{["success","error","blocked","updated"].map(outcome => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}</select></label></div>
    {activity.isError ? <div className="admin-state" role="alert"><p>{t($ => $.load_error)}</p><Button variant="outline" onClick={() => void activity.refetch()}>{t($ => $.refresh)}</Button></div>
      : activity.isPending ? <div className="admin-state" role="status">{t($ => $.loading)}</div>
        : !activity.data.items.length ? <div className="admin-state"><Activity /><p>{t($ => $.empty_activity)}</p></div>
          : <div className="admin-table-scroll"><table className="admin-table admin-activity-table"><thead><tr><th>{t($ => $.time)}</th><th>{t($ => $.caller)}</th><th>{t($ => $.workspace)}</th><th>{t($ => $.action)}</th><th>{t($ => $.outcome)}</th><th>{t($ => $.duration)}</th></tr></thead><tbody>{activity.data.items.map(item => <tr key={item.id}><td><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString(i18n.language)}</time></td><td><span>{item.actorName || item.actorEmail || item.actorId}</span><small>{item.actorEmail}</small></td><td>{item.workspaceName || t($ => $.global_scope)}<small>{item.workspaceSlug}</small></td><td><code>{item.kind==="policy_change" ? t($ => $.policy_changed) : item.toolName}</code>{item.kind==="policy_change" && <small>{t($ => $.policy_revision,{revision:String(item.details.revision ?? "")})} · {item.details.enabled===true ? t($ => $.enabled) : t($ => $.disabled)}</small>}</td><td><span className={`admin-outcome admin-outcome-${["success","error","blocked","updated"].includes(item.outcome) ? item.outcome : "unknown"}`}>{outcomeLabel(item.outcome)}</span>{item.errorCode && <small>{item.errorCode}</small>}</td><td>{item.kind==="call" ? `${item.durationMs} ms` : "—"}</td></tr>)}</tbody></table></div>}
    <div className="admin-log-footer"><p>{t($ => $.privacy)}</p><div className="admin-actions"><Button size="icon-sm" variant="outline" aria-label={t($ => $.previous)} disabled={!cursors.length || activity.isFetching} onClick={() => setCursors(cursors.slice(0,-1))}><ChevronLeft /></Button><Button size="icon-sm" variant="outline" aria-label={t($ => $.next)} disabled={!activity.data?.nextCursor || activity.isFetching} onClick={() => {const next=activity.data?.nextCursor;if(next)setCursors([...cursors,next]);}}><ChevronRight /></Button></div></div>
  </section>;
}
