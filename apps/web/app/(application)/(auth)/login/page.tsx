import { getRequestLocale } from "@/lib/request-locale";
import { creationFromNextUrl } from "@/lib/creation-entry";
import { LoginShell } from "@/features/auth/login-shell";
import LoginForm from "@/features/auth/login-form";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const [locale, params] = await Promise.all([getRequestLocale(), searchParams]);
  const creation = creationFromNextUrl(typeof params.next === "string" ? params.next : undefined);

  return (
    <LoginShell locale={locale} creation={creation}>
      <LoginForm />
    </LoginShell>
  );
}
