import type { IssueStatus } from "@auro/core/types";
import { StatusIcon } from "./status-icon";
import { useWorkspaceId } from "@auro/core/hooks";
import { useIssueStatuses } from "@auro/core/issue-statuses/hooks";
import { useStatusLabel } from "../utils/status-label";

export function StatusHeading({
  status,
  count,
}: {
  status: IssueStatus;
  count: number;
}) {
  const wsId = useWorkspaceId();
  const labelOf = useStatusLabel(wsId);
  const { categoryOf, colorOf, iconOf } = useIssueStatuses(wsId);
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold">
        <StatusIcon category={categoryOf(status)} color={colorOf(status)} icon={iconOf(status)} status={status} className="h-3 w-3" />
        {labelOf(status)}
      </span>
      <span className="text-caption text-muted-foreground">{count}</span>
    </div>
  );
}
