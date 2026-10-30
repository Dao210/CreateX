"use client";

import { useState } from "react";
import { Cable, Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@auro/ui/components/ui/collapsible";
import { Input } from "@auro/ui/components/ui/input";
import { Textarea } from "@auro/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { api } from "@auro/core/api";
import { buildTankMCPContext, buildTankMCPManualConfig } from "@auro/core/tank-defense";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

type CopyTarget = "instructions" | "config";

export function TankMCPConnection({ workspace, userId }: {
  workspace: { id: string; slug: string; name?: string };
  userId: string;
}) {
  const { t } = useT("tanks");
  const navigation = useNavigation();
  const [client, setClient] = useState("codex");
  const [command, setCommand] = useState("auro");
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState<CopyTarget | null>(null);
  const context = buildTankMCPContext({
    appUrl: navigation.getShareableUrl("/"),
    serverUrl: api.getBaseUrl(),
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    userId,
  });
  const instructions = `${t($ => $.garage.connect_prompt)}\n\n${JSON.stringify(context, null, 2)}`;
  const manual = buildTankMCPManualConfig(context, command, client);

  const resetCopy = () => { setCopied(null); setCopyError(null); };
  const copy = async (text: string, target: CopyTarget) => {
    resetCopy();
    try { await navigator.clipboard.writeText(text); setCopied(target); }
    catch { setCopyError(target); }
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
        <Button className="w-full" onClick={() => void copy(instructions, "instructions")}>
          {copied === "instructions" ? <Check /> : <Copy />}
          {copied === "instructions" ? t($ => $.garage.copied) : t($ => $.garage.copy_instructions)}
        </Button>
        <p className="tank-mcp-help" role="status">
          {copied === "instructions" ? t($ => $.garage.paste_instructions) : t($ => $.garage.connect_signin)}
        </p>
        {copyError === "instructions" && <>
          <p role="alert" className="tank-garage-error">{t($ => $.garage.copy_error)}</p>
          <Textarea readOnly value={instructions} aria-label={t($ => $.garage.copy_instructions)} className="tank-mcp-instructions" onFocus={event => event.currentTarget.select()} />
        </>}
      </div>
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
            <Button variant="outline" onClick={() => void copy(manual.config, "config")}>
              {copied === "config" ? <Check /> : <Copy />}
              {copied === "config" ? t($ => $.garage.copied) : t($ => $.garage.copy)}
            </Button>
            {copyError === "config" && <p role="alert" className="tank-garage-error">{t($ => $.garage.copy_error)}</p>}
            <p className="tank-mcp-help">{t($ => $.garage.connect_credentials)}</p>
            <pre className="tank-mcp-config" tabIndex={0} aria-label={t($ => $.garage.login_command)}>{manual.login}</pre>
            <code className="tank-mcp-endpoint">{manual.endpoint}</code>
            <a href={context.setup_url} target="_blank" rel="noopener noreferrer" className="tank-mcp-guide">{t($ => $.garage.setup_guide)}</a>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </DialogContent>
  </Dialog>;
}
