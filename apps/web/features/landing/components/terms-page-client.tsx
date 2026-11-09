"use client";

import { DocumentPage, DocumentSections } from "./document-page";
import { useLocale } from "../i18n";

export function TermsPageClient() {
  const { t } = useLocale();
  const p = t.terms;

  return (
    <DocumentPage title={p.title} meta={p.lastUpdated} intro={p.intro}>
      <DocumentSections sections={p.sections} />
    </DocumentPage>
  );
}
