import { ApplicationShell } from "@/components/application-shell";
import "../application.css";

export default function ApplicationLayout({ children }: { children: React.ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
