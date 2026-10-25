"use client";

import { useRef } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@auro/ui/components/ui/dropdown-menu";
import { useT } from "../../i18n";

interface ChatAddMenuProps {
  onSelectFile?: (file: File) => void;
  disabled?: boolean;
}

export function ChatAddMenu({ onSelectFile, disabled }: ChatAddMenuProps) {
  const { t } = useT("chat");
  const inputRef = useRef<HTMLInputElement>(null);
  if (!onSelectFile) return null;

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={t(($) => $.input.add_tooltip)} title={t(($) => $.input.add_tooltip)} className="rounded-full text-muted-foreground"><Plus /></Button>} />
      <DropdownMenuContent align="start" side="top" sideOffset={6}>
        <DropdownMenuItem onClick={() => inputRef.current?.click()}><ImageIcon />{t(($) => $.input.upload_file)}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <input ref={inputRef} type="file" multiple className="hidden" accept="*/*" onChange={(event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      for (const file of files) onSelectFile(file);
    }} />
  </>;
}
