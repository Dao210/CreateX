import { redirect } from "next/navigation";
import { paths } from "@auro/core/paths";

export default async function WorkspaceIndex({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(paths.workspace(workspaceSlug).root());
}
