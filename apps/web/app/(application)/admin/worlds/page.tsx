import type { Metadata } from "next";
import { AdminClient } from "../admin-client";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminWorldsPage() {
  return <AdminClient module="worlds" />;
}
