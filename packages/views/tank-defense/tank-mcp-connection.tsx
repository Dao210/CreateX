"use client";

import { useState } from "react";
import { Cable, Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@auro/ui/components/ui/collapsible";
import { Input } from "@auro/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { api } from "@auro/core/api";
import { buildTankMCPContext, buildTankMCPInstructions, buildTankMCPManualConfig } from "@auro/core/tank-defense";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { AIConnectionSteps, AIInstructionCopy } from "../common/ai-instruction-copy";

export function TankMCPConnection({ workspace, userId }: {
  workspace: { id: string; slug: string; name?: string };
  userId: string;
}) {
  const { t } = useT("tanks");
  const { t: common } = useT("common");
  const navigation = useNavigation();
  const [client, setClient] = useState("codex");
  const [command, setCommand] = useState("auro");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const context = buildTankMCPContext({
    appUrl: navigation.getShareableUrl("/"),
    serverUrl: api.getBaseUrl(),
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    userId,
  });
  const instructions = buildTankMCPInstructions(context, t($ => $.garage.connect_prompt));
  const manual = buildTankMCPManualConfig(context, command, client);

  const resetCopy = () => { setCopied(false); setCopyError(false); };
  const copy = async (text: string) => {
    resetCopy();
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setCopyError(true); }
  };

  return <Dialog onOpenChange={resetCopy}>
    <DialogTrigger render={<Button variant="outline" size="sm" />}>
      <Cable />{t($ => $.garage.connect)}
    </DialogTrigger>
    <DialogContent className="tank-mcp-dialog">
      <DialogHeader>
        <DialogTitle>{t($ => $.garage.connect)}</DialogTitle>
        <DialogDescription>{t($ => $.garage.connect_help)}</DialogDescription>
      </DialogHeader>
      <div className="tank-mcp-connect">
        <AIConnectionSteps />
        <AIInstructionCopy instructions={instructions} label={t($ => $.garage.copy_instructions)} instructionsLabel={t($ => $.garage.copy_instructions)} repeatLabel={common($ => $.ai_tools.copy_again)} />
      </div>
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="tank-mcp-manual-trigger" />}>
          {t($ => $.garage.try_tasks)}<ChevronDown aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-4 pt-2">
            {[t($ => $.garage.agent_example), t($ => $.garage.list_example)].map(task => <div key={task} className="grid gap-2 rounded-md border p-3">
              <p className="text-caption leading-relaxed">{task}</p>
              <AIInstructionCopy instructions={buildTankMCPInstructions(context, t($ => $.garage.task_prompt), task)} label={t($ => $.garage.copy_task)} secondary />
            </div>)}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <Collapsible className="tank-mcp-manual">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="tank-mcp-manual-trigger" />}>
          {t($ => $.garage.manual_config)}<ChevronDown />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="tank-mcp-manual-content">
            <label className="tank-form-field">
              <span>{t($ => $.garage.client)}</span>
              <select value={client} onChange={event => { setClient(event.currentTarget.value); resetCopy(); }}>
                <option value="codex">{t($ => $.garage.codex)}</option>
                <option value="json">{t($ => $.garage.other_clients)}</option>
              </select>
            </label>
            <label className="tank-form-field">
              <span>{t($ => $.garage.cli_path)}</span>
              <Input value={command} onChange={event => { setCommand(event.currentTarget.value); resetCopy(); }} />
            </label>
            <pre className="tank-mcp-config" tabIndex={0}>{manual.config}</pre>
            <Button variant="outline" onClick={() => void copy(manual.config)}>
              {copied ? <Check /> : <Copy />}
              {copied ? t($ => $.garage.copied) : t($ => $.garage.copy)}
            </Button>
            {copyError && <p role="alert" className="tank-garage-error">{t($ => $.garage.copy_error)}</p>}
            <p className="tank-mcp-help">{t($ => $.garage.connect_credentials)}</p>
            <pre className="tank-mcp-config" tabIndex={0} aria-label={t($ => $.garage.login_command)}>{manual.login}</pre>
            <code className="tank-mcp-endpoint">{manual.endpoint}</code>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <a href={context.setup_url} target="_blank" rel="noopener noreferrer" className="tank-mcp-guide">{t($ => $.garage.setup_guide)}</a>
    </DialogContent>
  </Dialog>;
}
