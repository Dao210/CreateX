"use client";

import { Cable, X } from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

export function TankConnectionReturn() {
  const navigation = useNavigation();
  const { t } = useT("tanks");
  if (navigation.searchParams.get("from") !== "tank-connect") return null;
  const dismiss = () => {
    const params = new URLSearchParams(navigation.searchParams);
    params.delete("from");
    navigation.replace(`${navigation.pathname}${params.size ? `?${params}` : ""}${navigation.hash}`);
  };
  return <aside className="tank-connection-return" role="status" aria-label={t($ => $.garage.connect)}>
    <Cable className="size-4 shrink-0" aria-hidden />
    <p>{t($ => $.garage.return_hint)}</p>
    <Button variant="ghost" size="icon-sm" aria-label={t($ => $.garage.dismiss_return_hint)} onClick={dismiss}><X /></Button>
  </aside>;
}
