import { useParams, useSearchParams } from "react-router-dom";
import { AttachmentPreviewPage } from "@auro/views/attachments";
import { ErrorBoundary } from "@auro/ui/components/common/error-boundary";

export function AttachmentPreviewRoute() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const filename = searchParams.get("name") ?? undefined;
  // Query and fragment the document opens at (the viewer's address bar).
  const initialAddress = searchParams.get("loc") ?? undefined;

  if (!id) return null;
  return (
    <ErrorBoundary resetKeys={[id]}>
      <AttachmentPreviewPage
        attachmentId={id}
        filename={filename}
        initialAddress={initialAddress}
      />
    </ErrorBoundary>
  );
}
