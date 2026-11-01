"use client";

import type { ReactNode } from "react";
import { useWorldGames, type GameId } from "@auro/core/admin";
import { useCurrentWorkspace } from "@auro/core/paths";
import { Button } from "@auro/ui/components/ui/button";
import { useT } from "../i18n";

export function GameAccessBoundary({ gameId, children }: { gameId: GameId; children: ReactNode }) {
  const workspace = useCurrentWorkspace();
  const query = useWorldGames(workspace?.id ?? "");
  const { t } = useT("admin");
  if (!workspace || query.isPending) return <div role="status" className="p-6 text-body text-muted-foreground">{t($ => $.loading)}</div>;
  if (query.isError) return <div role="alert" className="space-y-3 p-6 text-body"><p>{t($ => $.game_policy_error)}</p><Button variant="outline" onClick={() => void query.refetch()}>{t($ => $.refresh)}</Button></div>;
  if (!query.data.games.find(game => game.gameId === gameId)?.available) return <div role="status" className="p-6 text-body text-muted-foreground">{t($ => $.game_not_open)}</div>;
  return children;
}
