"use client";

import { useState } from "react";
import { Cable, Copy } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { Input } from "@auro/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@auro/ui/components/ui/dialog";
import { api } from "@auro/core/api";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

export function TankMCPConnection({ workspaceId }: { workspaceId: string }) {
  const { t } = useT("tanks");
  const navigation = useNavigation();
  const [client, setClient] = useState("codex");
  const [command, setCommand] = useState("auro");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const server = api.getBaseUrl() || new URL(navigation.getShareableUrl("/")).origin;
  const profile = `tanks-${workspaceId.slice(0, 8)}`;
  const args = ["--server-url", server, "--workspace-id", workspaceId, "--profile", profile, "tanks", "mcp"];
  const config = client === "codex" ? `[mcp_servers.auro_tanks]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}` : JSON.stringify({ mcpServers: { auro_tanks: { type: "stdio", command, args } } }, null, 2);
  return <Dialog onOpenChange={() => setCopyState("idle")}>
    <DialogTrigger render={<Button variant="outline" size="sm" />}><Cable />{t($ => $.garage.connect)}</DialogTrigger>
    <DialogContent className="tank-mcp-dialog"><DialogHeader><DialogTitle>{t($ => $.garage.connect)}</DialogTitle><DialogDescription>{t($ => $.garage.connect_help)}</DialogDescription></DialogHeader>
      <label className="tank-form-field"><span>{t($ => $.garage.client)}</span><select value={client} onChange={event => { setClient(event.currentTarget.value); setCopyState("idle"); }}><option value="codex">{t($ => $.garage.codex)}</option><option value="json">{t($ => $.garage.other_clients)}</option></select></label>
      <label className="tank-form-field"><span>{t($ => $.garage.cli_path)}</span><Input value={command} onChange={event => { setCommand(event.currentTarget.value); setCopyState("idle"); }} /></label>
      <pre className="tank-mcp-config" tabIndex={0}>{config}</pre>
      <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(config); setCopyState("copied"); } catch { setCopyState("error"); } }}><Copy />{copyState === "copied" ? t($ => $.garage.copied) : t($ => $.garage.copy)}</Button>
      {copyState === "error" && <p role="alert">{t($ => $.garage.copy_error)}</p>}
      <p className="tank-mcp-help">{t($ => $.garage.connect_credentials)}</p>
      <pre className="tank-mcp-config" aria-label={t($ => $.garage.login_command)}>{`'${command.replaceAll("'", "'\\''")}' --server-url '${server.replaceAll("'", "'\\''")}' --profile ${profile} login`}</pre>
      <code className="tank-mcp-endpoint">{`${server}/api/tanks/mcp`}</code>
      <p className="tank-mcp-help">{t($ => $.garage.agent_example)}</p>
    </DialogContent>
  </Dialog>;
}
