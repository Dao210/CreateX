"use client";
import { useState } from "react";
import { Cable, Copy, Check } from "lucide-react";
import { api } from "@auro/core/api";
import { buildFishMCPContext } from "@auro/core/fish";
import { Button } from "@auro/ui/components/ui/button";
import { Textarea } from "@auro/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
export function FishConnection({ workspace, userId }: { workspace: { id: string; slug: string; name: string }; userId: string }) {
 const { t } = useT("fish"), navigation = useNavigation();
 const [copied, setCopied] = useState(false), [error, setError] = useState(false);
 const context = buildFishMCPContext({ appUrl: navigation.getShareableUrl("/"), serverUrl: api.getBaseUrl(), workspaceId: workspace.id, workspaceSlug: workspace.slug, workspaceName: workspace.name, userId });
 const instructions = `${t($ => $.connect_prompt)}\n\n${JSON.stringify(context, null, 2)}`;
 return <Dialog><DialogTrigger render={<Button variant="outline" size="sm" />}><Cable />{t($ => $.connect)}</DialogTrigger><DialogContent><DialogHeader><DialogTitle>{t($ => $.connect)}</DialogTitle><DialogDescription>{t($ => $.connect_help)}</DialogDescription></DialogHeader><Button onClick={async () => { try { await navigator.clipboard.writeText(instructions); setCopied(true); setError(false); } catch { setError(true); } }}>{copied ? <Check /> : <Copy />}{copied ? t($ => $.copied) : t($ => $.copy_instructions)}</Button>{error && <><p role="alert">{t($ => $.copy_error)}</p><Textarea aria-label={t($ => $.copy_instructions)} readOnly value={instructions} onFocus={e => e.currentTarget.select()} /></>}<a href={context.setup_url} target="_blank" rel="noopener noreferrer" className="text-caption underline">{t($ => $.guide)}</a></DialogContent></Dialog>;
}
