import type { Metadata } from "next";
import { AdminClient } from "./admin-client";

export const metadata: Metadata = { title: "MCP Admin", robots: { index:false,follow:false } };
export default function Page() { return <AdminClient />; }
