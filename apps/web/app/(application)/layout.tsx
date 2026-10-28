import { ApplicationShell } from "@/components/application-shell";

export default function ApplicationLayout({ children }: { children: React.ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
