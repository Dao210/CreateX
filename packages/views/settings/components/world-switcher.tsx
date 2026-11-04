"use client";

import { ArrowLeftRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@auro/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@auro/ui/components/ui/collapsible";
import { api } from "@auro/core/api";
import { hasOtherWorkspaceUnread, inboxUnreadSummaryOptions, unreadWorkspaceIds } from "@auro/core/inbox/queries";
import { paths } from "@auro/core/paths";
import { myInvitationListOptions, workspaceKeys, workspaceListOptions } from "@auro/core/workspace/queries";
import { useT } from "../../i18n";
import { AppLink, useNavigation } from "../../navigation";
import { WorkspaceAvatar } from "../../workspace/workspace-avatar";

export function WorldSwitcher({ workspaceId }: { workspaceId: string }) {
  const { t } = useT("layout");
  const { push } = useNavigation();
  const queryClient = useQueryClient();
  const { data: worlds } = useQuery(workspaceListOptions());
  const { data: invitations } = useQuery(myInvitationListOptions());
  const { data: unread } = useQuery(inboxUnreadSummaryOptions());
  const unreadWorlds = unreadWorkspaceIds(unread ?? []);
  const refreshInvitations = () => queryClient.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptInvitation(id),
    onSuccess: async (_, id) => {
      const joinedWorldId = invitations?.find(invitation => invitation.id === id)?.workspace_id;
      void refreshInvitations();
      const updatedWorlds = await queryClient.fetchQuery({ ...workspaceListOptions(), staleTime: 0 });
      const joined = updatedWorlds.find(world => world.id === joinedWorldId);
      if (joined) push(paths.workspace(joined.slug).root());
    },
    onError: refreshInvitations,
  });
  const decline = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    onSettled: refreshInvitations,
  });
  const responding = accept.isPending || decline.isPending;

  return (
    <Collapsible key={workspaceId}>
      <div className="flex justify-end">
        <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
          <ArrowLeftRight aria-hidden="true" />
          {t($ => $.sidebar.switch_world)}
          {((invitations?.length ?? 0) > 0 || hasOtherWorkspaceUnread(unread ?? [], workspaceId)) && (
            <span className="size-1.5 rounded-full bg-brand" />
          )}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-2 rounded-lg border border-border p-2">
        <ul aria-label={t($ => $.sidebar.workspaces_label)}>
          {worlds?.map(world => (
            <li key={world.id}>
              {world.id === workspaceId ? (
                <div aria-current="true" className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-body">
                  <WorkspaceAvatar name={world.name} avatarUrl={world.avatar_url} size="sm" />
                  <span className="min-w-0 flex-1 truncate" title={world.name}>{world.name}</span>
                  <span className="text-caption text-muted-foreground">{t($ => $.sidebar.current_world)}</span>
                </div>
              ) : (
                <AppLink
                  href={paths.workspace(world.slug).root()}
                  aria-label={world.name}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <WorkspaceAvatar name={world.name} avatarUrl={world.avatar_url} size="sm" />
                  <span className="min-w-0 flex-1 truncate" title={world.name}>{world.name}</span>
                  {unreadWorlds.has(world.id) && <span className="size-2 shrink-0 rounded-full bg-brand" />}
                </AppLink>
              )}
            </li>
          ))}
        </ul>
        {invitations && invitations.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <h4 className="px-2 text-caption text-muted-foreground">{t($ => $.sidebar.pending_invitations_label)}</h4>
            <ul>
              {invitations.map(invitation => {
                const name = invitation.workspace_name ?? t($ => $.sidebar.invitation_workspace_fallback);
                return (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                    <WorkspaceAvatar name={name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-body" title={name}>{name}</span>
                    <Button size="sm" disabled={responding} onClick={() => accept.mutate(invitation.id)}>
                      {t($ => $.sidebar.invitation_join)}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={responding} onClick={() => decline.mutate(invitation.id)}>
                      {t($ => $.sidebar.invitation_decline)}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
