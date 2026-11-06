import type { Metadata } from "next";
import { AdminClient } from "../../admin-client";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminWorldPage({ params }: { params: Promise<{ worldId: string }> }) {
  const { worldId } = await params;
  return <AdminClient module="worlds" worldId={worldId} />;
}
