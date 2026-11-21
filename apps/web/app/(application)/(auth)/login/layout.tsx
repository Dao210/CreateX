import type { Metadata } from "next";
import { instrumentSerif } from "@/lib/landing-font";
import styles from "@/features/auth/login-shell.module.css";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${instrumentSerif.variable} landing-type ${styles.page}`}>
      {children}
    </div>
  );
}
